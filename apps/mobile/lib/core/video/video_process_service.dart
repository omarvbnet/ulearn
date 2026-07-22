import 'dart:async';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:video_compress/video_compress.dart' as legacy;
import 'package:video_compress_kit/video_compress_kit.dart';

export 'video_upload_service.dart';

class VideoWatermarkSettings {
  const VideoWatermarkSettings({
    required this.brandText,
    required this.opacity,
    required this.fontSize,
    required this.position,
    required this.includeCourseName,
    required this.includeInstructorName,
    this.courseName,
    this.instructorName,
  });

  final String brandText;
  final double opacity;
  final int fontSize;
  final String position;
  final bool includeCourseName;
  final bool includeInstructorName;
  final String? courseName;
  final String? instructorName;

  factory VideoWatermarkSettings.fromApi(Map<String, dynamic> json) {
    final config = json['config'] as Map<String, dynamic>? ?? json;
    return VideoWatermarkSettings(
      brandText: config['brandText']?.toString() ?? 'U Learn',
      opacity: (config['opacity'] as num?)?.toDouble() ?? 0.45,
      fontSize: (config['fontSize'] as num?)?.toInt() ?? 28,
      position: config['position']?.toString() ?? 'bottom-right',
      includeCourseName: config['includeCourseName'] as bool? ?? true,
      includeInstructorName: config['includeInstructorName'] as bool? ?? true,
    );
  }

  String buildLabel() {
    final parts = <String>[brandText];
    if (includeCourseName && courseName != null && courseName!.trim().isNotEmpty) {
      parts.add(courseName!.trim());
    }
    if (includeInstructorName &&
        instructorName != null &&
        instructorName!.trim().isNotEmpty) {
      parts.add(instructorName!.trim());
    }
    return parts.join(' · ').replaceAll("'", '').replaceAll(':', ' ').trim();
  }
}

/// Fast upload prep via hardware encoders (VideoToolbox / MediaCodec).
///
/// Always targets **1080p** (never drops to 720/480). Speed comes from HW
/// encode + efficient bitrate — not from lowering resolution.
///
/// Never burns watermarks at upload time (playback overlays handle that).
class VideoProcessService {
  static const _kit = VideoCompressKit();

  /// Files at/above this size are always compressed to 1080p before upload.
  static const int forceCompressBytes = 800 * 1024 * 1024;

  /// Shorts must stay under this size after compression.
  static const int shortsMaxBytes = 350 * 1024 * 1024;

  /// Efficient 1080p H.264 bitrate (~5.5 Mbps). Keeps Full HD look while
  /// shrinking multi‑GB camera rolls and keeping HW encode fast.
  static const int _bitrate1080p = 5_500_000;

  /// Retry bitrate if the first 1080p pass fails / times out.
  static const int _bitrate1080pFast = 3_800_000;

  /// Leaner 1080p bitrate used when targeting a max output size (shorts).
  static const int _bitrate1080pCompact = 2_800_000;

  static bool mustProcess(File source) {
    final name = source.path.toLowerCase();
    if (name.endsWith('.mov') ||
        name.endsWith('.m4v') ||
        name.endsWith('.hevc') ||
        name.endsWith('.mkv') ||
        name.endsWith('.avi') ||
        name.endsWith('.3gp')) {
      return true;
    }
    try {
      final bytes = source.lengthSync();
      if (bytes >= forceCompressBytes) return true;
      return bytes >= 40 * 1024 * 1024;
    } catch (_) {
      return true;
    }
  }

  static String formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  static Duration _timeoutForSize(int sourceBytes) {
    // Soft ceilings — HW 1080p should finish well under these; never 12+ min.
    if (sourceBytes >= 800 * 1024 * 1024) return const Duration(minutes: 5);
    if (sourceBytes >= 300 * 1024 * 1024) return const Duration(minutes: 4);
    return const Duration(minutes: 3);
  }

  static CompressionConfig _config1080p({required int bitrate}) {
    return CompressionConfig(
      // high = max long edge 1920 (true 1080p for landscape & portrait).
      quality: VideoQuality.high,
      bitrate: bitrate,
      includeAudio: true,
      deleteOrigin: false,
      // Do NOT set frameRate or fixed width — preserves aspect & avoids slow paths.
      faststart: true,
      h264Profile: H264Profile.high,
      bitrateMode: BitrateMode.vbr,
    );
  }

  /// Compress for upload. [watermark] is ignored (playback overlays protect).
  ///
  /// When [maxOutputBytes] is set (e.g. shorts 350 MB), retries with a leaner
  /// 1080p bitrate if the first pass is still too large.
  static Future<({File file, int? width, int? height, int sourceBytes, int outputBytes})>
      processForUpload({
    required File source,
    VideoWatermarkSettings? watermark,
    void Function(double progress)? onProgress,
    int? maxOutputBytes,
  }) async {
    final sourceBytes = await source.length();
    onProgress?.call(0.02);

    final lower = source.path.toLowerCase();
    final force = sourceBytes >= forceCompressBytes || maxOutputBytes != null;
    if (!force && lower.endsWith('.mp4') && sourceBytes < 40 * 1024 * 1024) {
      onProgress?.call(1.0);
      return (
        file: source,
        width: null,
        height: null,
        sourceBytes: sourceBytes,
        outputBytes: sourceBytes,
      );
    }

    final bitrates = maxOutputBytes != null
        ? <int>[_bitrate1080pCompact, _bitrate1080pFast]
        : <int>[_bitrate1080p, _bitrate1080pFast];

    for (final bitrate in bitrates) {
      final kitOut = await _compressWithKit(
        source: source,
        sourceBytes: sourceBytes,
        config: _config1080p(bitrate: bitrate),
        onProgress: onProgress,
      );
      if (kitOut == null) continue;
      if (maxOutputBytes != null && kitOut.outputBytes > maxOutputBytes) {
        continue;
      }
      onProgress?.call(1.0);
      return kitOut;
    }

    // Legacy 1080p export once (no frameRate — avoids slow iOS path).
    final legacyOut = await _compressLegacy(
      source: source,
      sourceBytes: sourceBytes,
      quality: legacy.VideoQuality.Res1920x1080Quality,
      onProgress: onProgress,
    );
    if (legacyOut != null) {
      if (maxOutputBytes == null || legacyOut.outputBytes <= maxOutputBytes) {
        onProgress?.call(1.0);
        return legacyOut;
      }
    }

    // Last resort: original only if under the max (shorts) or no max set.
    if (maxOutputBytes != null && sourceBytes > maxOutputBytes) {
      throw StateError('VIDEO_TOO_LARGE');
    }

    onProgress?.call(1.0);
    return (
      file: source,
      width: null,
      height: null,
      sourceBytes: sourceBytes,
      outputBytes: sourceBytes,
    );
  }

  static Future<({File file, int? width, int? height, int sourceBytes, int outputBytes})?>
      _compressWithKit({
    required File source,
    required int sourceBytes,
    required CompressionConfig config,
    void Function(double progress)? onProgress,
  }) async {
    final sessionId =
        'ulearn_${DateTime.now().microsecondsSinceEpoch}_${config.bitrate ?? 0}';

    StreamSubscription<Map<String, dynamic>>? sub;
    try {
      sub = _kit.compressionProgress
          .where((e) => e['sessionId'] == sessionId)
          .listen((e) {
        final p = (e['progress'] as num?)?.toDouble() ?? 0;
        onProgress?.call(p.clamp(0.03, 0.97));
      });

      final result = await _kit
          .compressVideo(
            source.path,
            sessionId: sessionId,
            config: config,
          )
          .timeout(
            _timeoutForSize(sourceBytes),
            onTimeout: () {
              unawaited(_kit.cancelCompression(sessionId: sessionId));
              return const CompressionResult(
                isSuccessful: false,
                error: 'timeout',
              );
            },
          );

      if (!result.isSuccessful || result.isCancelled) return null;
      final path = result.outputPath;
      if (path == null || path.isEmpty) return null;
      final out = File(path);
      if (!await out.exists()) return null;
      final outBytes = result.fileSize ?? await out.length();
      if (outBytes <= 0) return null;

      // Reject "compression" that barely shrunk a huge file (failed encode).
      if (sourceBytes >= 200 * 1024 * 1024 && outBytes > sourceBytes * 0.95) {
        try {
          await out.delete();
        } catch (_) {}
        return null;
      }

      int? width;
      int? height;
      try {
        final info = await _kit.getMediaInfo(path);
        width = info.width;
        height = info.height;
      } catch (_) {}

      return (
        file: out,
        width: width,
        height: height,
        sourceBytes: sourceBytes,
        outputBytes: outBytes,
      );
    } catch (_) {
      try {
        await _kit.cancelCompression(sessionId: sessionId);
      } catch (_) {}
      return null;
    } finally {
      await sub?.cancel();
    }
  }

  static Future<({File file, int? width, int? height, int sourceBytes, int outputBytes})?>
      _compressLegacy({
    required File source,
    required int sourceBytes,
    required legacy.VideoQuality quality,
    void Function(double progress)? onProgress,
  }) async {
    if (legacy.VideoCompress.isCompressing) {
      try {
        await legacy.VideoCompress.cancelCompression();
      } catch (_) {}
    }

    final sub = legacy.VideoCompress.compressProgress$.subscribe((p) {
      onProgress?.call((p / 100.0).clamp(0.03, 0.97));
    });

    try {
      final info = await legacy.VideoCompress.compressVideo(
        source.path,
        quality: quality,
        deleteOrigin: false,
        includeAudio: true,
      ).timeout(
        Duration(minutes: sourceBytes >= 500 * 1024 * 1024 ? 4 : 3),
        onTimeout: () {
          unawaited(legacy.VideoCompress.cancelCompression());
          return null;
        },
      );

      final path = info?.path;
      if (path == null || path.isEmpty) return null;
      final out = File(path);
      if (!await out.exists()) return null;
      final outBytes = await out.length();
      if (outBytes <= 0) return null;

      return (
        file: out,
        width: info?.width,
        height: info?.height,
        sourceBytes: sourceBytes,
        outputBytes: outBytes,
      );
    } catch (_) {
      try {
        await legacy.VideoCompress.cancelCompression();
      } catch (_) {}
      return null;
    } finally {
      sub.unsubscribe();
    }
  }

  /// Clear compressor temp files after a successful upload.
  ///
  /// Never calls [VideoCompress.deleteAllCache] — that wipes auto-generated
  /// cover JPEGs still needed for the cover upload step.
  static Future<void> clearTemp() async {
    try {
      final dir = await getTemporaryDirectory();
      await for (final entity in dir.list(recursive: true, followLinks: false)) {
        if (entity is! File) continue;
        final path = entity.path;
        final name = entity.uri.pathSegments.isNotEmpty
            ? entity.uri.pathSegments.last
            : '';
        final lower = name.toLowerCase();

        // Keep cover images and unrelated temp files.
        if (name.startsWith('ulearn_cover_')) continue;
        if (lower.endsWith('.jpg') ||
            lower.endsWith('.jpeg') ||
            lower.endsWith('.png') ||
            lower.endsWith('.webp')) {
          continue;
        }

        final isVideoTemp = name.startsWith('vck_') ||
            (name.startsWith('ulearn_') &&
                (lower.endsWith('.mp4') ||
                    lower.endsWith('.mov') ||
                    lower.endsWith('.m4v'))) ||
            (path.contains('video_compress') &&
                (lower.endsWith('.mp4') ||
                    lower.endsWith('.mov') ||
                    lower.endsWith('.m4v')));
        if (!isVideoTemp) continue;
        try {
          await entity.delete();
        } catch (_) {}
      }
    } catch (_) {}
  }
}
