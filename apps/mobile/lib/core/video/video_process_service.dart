import 'dart:async';
import 'dart:io';

import 'package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart';
import 'package:ffmpeg_kit_flutter_new/ffprobe_kit.dart';
import 'package:ffmpeg_kit_flutter_new/return_code.dart';
import 'package:ffmpeg_kit_flutter_new/statistics.dart';
import 'package:path_provider/path_provider.dart';

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

/// Encode profile tuned for phone camera files (especially large iPhone .mov).
class _EncodeProfile {
  const _EncodeProfile({
    required this.maxWidth,
    required this.maxHeight,
    required this.videoBitrate,
    required this.audioBitrate,
    required this.fps,
  });

  final int maxWidth;
  final int maxHeight;
  final String videoBitrate;
  final String audioBitrate;
  final int fps;
}

/// Client-side FFmpeg: converts iPhone MOV/HEVC → compact H.264 MP4 with watermark.
///
/// Large camera rolls (1GB+) are scaled to 720p@30fps with hardware encode when
/// available so a ~1500 MB .mov typically becomes ~40–120 MB.
class VideoProcessService {
  /// Always re-encode these — raw upload is too large / wrong container for R2.
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
      return source.lengthSync() >= 80 * 1024 * 1024;
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

  static _EncodeProfile _profileFor(int sourceBytes) {
    // ~1.5 GB iPhone 4K/60fps → lean 720p lecture encode.
    if (sourceBytes >= 800 * 1024 * 1024) {
      return const _EncodeProfile(
        maxWidth: 1280,
        maxHeight: 720,
        videoBitrate: '1600k',
        audioBitrate: '96k',
        fps: 30,
      );
    }
    if (sourceBytes >= 200 * 1024 * 1024) {
      return const _EncodeProfile(
        maxWidth: 1280,
        maxHeight: 720,
        videoBitrate: '2000k',
        audioBitrate: '96k',
        fps: 30,
      );
    }
    return const _EncodeProfile(
      maxWidth: 1280,
      maxHeight: 720,
      videoBitrate: '2200k',
      audioBitrate: '96k',
      fps: 30,
    );
  }

  static String _fontPath() {
    if (Platform.isIOS) {
      return '/System/Library/Fonts/Supplemental/Arial.ttf';
    }
    return '/system/fonts/Roboto-Regular.ttf';
  }

  static String _positionExpr(String position) {
    switch (position) {
      case 'bottom-left':
        return 'x=24:y=h-th-24';
      case 'top-right':
        return 'x=w-tw-24:y=24';
      case 'top-left':
        return 'x=24:y=24';
      case 'bottom-right':
      default:
        return 'x=w-tw-24:y=h-th-24';
    }
  }

  /// Escape single quotes for FFmpeg filter / path args.
  static String _q(String path) => path.replaceAll("'", r"'\''");

  static List<_EncoderSpec> _encoderCandidates(String videoBitrate) {
    if (Platform.isIOS) {
      return [
        _EncoderSpec(
          name: 'h264_videotoolbox',
          // Hardware encode — critical for multi‑GB iPhone MOV files.
          args:
              '-c:v h264_videotoolbox -b:v $videoBitrate -maxrate $videoBitrate '
              '-bufsize 4M -realtime true -allow_sw 1 -pix_fmt yuv420p',
        ),
        _EncoderSpec(
          name: 'libx264-ultrafast',
          args:
              '-c:v libx264 -preset ultrafast -crf 28 -threads 0 -pix_fmt yuv420p',
        ),
      ];
    }
    return [
      _EncoderSpec(
        name: 'libx264-ultrafast',
        args: '-c:v libx264 -preset ultrafast -crf 28 -threads 0 -pix_fmt yuv420p',
      ),
    ];
  }

  static Future<int?> _probeDurationMs(String path) async {
    try {
      final session = await FFprobeKit.getMediaInformation(path);
      final info = session.getMediaInformation();
      final raw = info?.getDuration();
      if (raw == null || raw.isEmpty) return null;
      final sec = double.tryParse(raw);
      if (sec == null || sec <= 0) return null;
      if (sec > 10000) return sec.round();
      return (sec * 1000).round();
    } catch (_) {
      return null;
    }
  }

  static Future<({File file, int? width, int? height, int sourceBytes, int outputBytes})>
      processForUpload({
    required File source,
    required VideoWatermarkSettings watermark,
    void Function(double progress)? onProgress,
  }) async {
    final dir = await getTemporaryDirectory();
    final label = watermark.buildLabel();
    final font = _fontPath();
    final pos = _positionExpr(watermark.position);
    final alpha = watermark.opacity.clamp(0.1, 1.0).toStringAsFixed(2);
    final sourceBytes = await source.length();
    final profile = _profileFor(sourceBytes);
    final durationMs = await _probeDurationMs(source.path);

    // fps=30 cuts 60fps iPhone footage in half; scale+drawtext in one filter graph.
    final vf =
        "fps=${profile.fps},"
        "scale='min(${profile.maxWidth},iw)':'min(${profile.maxHeight},ih)':"
        "force_original_aspect_ratio=decrease:flags=fast_bilinear,"
        "drawtext=fontfile='${_q(font)}':text='${_q(label)}':"
        "fontsize=${watermark.fontSize.clamp(18, 26)}:"
        "fontcolor=white@$alpha:$pos:box=1:boxcolor=black@0.25:boxborderw=6";

    onProgress?.call(0.02);

    final hwaccel = Platform.isIOS ? '-hwaccel videotoolbox ' : '';
    final input = _q(source.path);

    Object? lastError;
    for (final encoder in _encoderCandidates(profile.videoBitrate)) {
      final outPath =
          '${dir.path}/ulearn_delivery_${DateTime.now().millisecondsSinceEpoch}_${encoder.name}.mp4';
      final cmd =
          '-y $hwaccel-i \'$input\' -vf "$vf" ${encoder.args} '
          '-c:a aac -b:a ${profile.audioBitrate} -ac 2 -ar 44100 '
          '-movflags +faststart \'$outPath\'';

      try {
        final file = await _executeWithProgress(
          cmd: cmd,
          outPath: outPath,
          durationMs: durationMs,
          onProgress: onProgress,
        );
        onProgress?.call(1.0);
        final outBytes = await file.length();
        return (
          file: file,
          width: profile.maxWidth,
          height: profile.maxHeight,
          sourceBytes: sourceBytes,
          outputBytes: outBytes,
        );
      } catch (e) {
        lastError = e;
        try {
          final failed = File(outPath);
          if (await failed.exists()) await failed.delete();
        } catch (_) {}
      }
    }

    throw Exception('Video processing failed: $lastError');
  }

  static Future<File> _executeWithProgress({
    required String cmd,
    required String outPath,
    required int? durationMs,
    void Function(double progress)? onProgress,
  }) async {
    final completer = Completer<void>();
    Object? error;
    var lastProgress = 0.05;
    var lastStatsAt = DateTime.now();

    void emit(double value) {
      if (onProgress == null) return;
      final next = value.clamp(0.0, 0.97);
      if (next + 0.002 < lastProgress) return;
      lastProgress = next;
      scheduleMicrotask(() => onProgress(next));
    }

    final heartbeat = Timer.periodic(const Duration(milliseconds: 400), (_) {
      if (completer.isCompleted) return;
      final stalled = DateTime.now().difference(lastStatsAt);
      if (stalled < const Duration(milliseconds: 800)) return;
      if (lastProgress >= 0.94) return;
      emit(lastProgress + 0.01);
    });

    await FFmpegKit.executeAsync(
      cmd,
      (session) async {
        final code = await session.getReturnCode();
        if (!ReturnCode.isSuccess(code)) {
          final logs = await session.getAllLogsAsString();
          error = Exception(logs ?? 'FFmpeg failed');
        }
        if (!completer.isCompleted) completer.complete();
      },
      null,
      (Statistics stats) {
        lastStatsAt = DateTime.now();
        if (durationMs == null || durationMs <= 0) {
          final frames = stats.getVideoFrameNumber();
          if (frames > 0) emit(0.05 + (frames % 900) / 1000 * 0.85);
          return;
        }
        final t = stats.getTime();
        if (t <= 0) return;
        emit(0.05 + (t / durationMs).clamp(0.0, 1.0) * 0.9);
      },
    );

    try {
      await completer.future;
    } finally {
      heartbeat.cancel();
    }

    if (error != null) throw error!;

    final out = File(outPath);
    if (!await out.exists() || await out.length() <= 0) {
      throw Exception('Processed video file missing');
    }
    return out;
  }
}

class _EncoderSpec {
  const _EncoderSpec({required this.name, required this.args});
  final String name;
  final String args;
}
