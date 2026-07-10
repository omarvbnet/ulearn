import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

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

class _MediaProbe {
  const _MediaProbe({
    required this.durationMs,
    required this.width,
    required this.height,
    required this.fps,
  });

  final int? durationMs;
  final int width;
  final int height;
  final double fps;
}

/// Medium-quality encode that **keeps source resolution** and prioritizes speed
/// (hardware H.264 when available, otherwise libx264 ultrafast).
class _EncodeProfile {
  const _EncodeProfile({
    required this.width,
    required this.height,
    required this.videoBitrate,
    required this.audioBitrate,
    required this.fps,
    required this.crf,
  });

  final int width;
  final int height;
  final String videoBitrate;
  final String audioBitrate;
  final int fps;
  /// Soft target for software encode (~23 = medium).
  final int crf;
}

/// Client-side FFmpeg: fast medium-quality H.264 MP4 at original resolution.
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

  /// Medium quality bitrate for the **actual** frame size (no downscale).
  static String _mediumBitrate({
    required int width,
    required int height,
    required double fps,
  }) {
    final pixels = math.max(1, width * height);
    final f = fps.clamp(24.0, 60.0);
    // ~0.09 bits/pixel/frame ≈ medium visual quality without crushing detail.
    final bps = (pixels * f * 0.09).round();
    final kbps = (bps / 1000).clamp(1000, 12000).round();
    // Round to nearest 100k for cleaner encoder targets.
    final rounded = ((kbps + 50) ~/ 100) * 100;
    return '${rounded}k';
  }

  static _EncodeProfile _profileFor(_MediaProbe probe) {
    final w = probe.width > 0 ? probe.width : 1280;
    final h = probe.height > 0 ? probe.height : 720;
    // Cap only extreme high-fps camera rolls for speed/size — resolution stays.
    final fps = probe.fps > 30.5 ? 30 : probe.fps.round().clamp(24, 60);
    return _EncodeProfile(
      width: w,
      height: h,
      videoBitrate: _mediumBitrate(width: w, height: h, fps: fps.toDouble()),
      audioBitrate: '128k',
      fps: fps,
      crf: 23,
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

  static List<_EncoderSpec> _encoderCandidates({
    required String videoBitrate,
    required int crf,
  }) {
    if (Platform.isIOS) {
      return [
        _EncoderSpec(
          name: 'h264_videotoolbox',
          // Hardware encode — fastest path on iPhone while keeping resolution.
          args:
              '-c:v h264_videotoolbox -b:v $videoBitrate -maxrate $videoBitrate '
              '-bufsize $videoBitrate -realtime true -allow_sw 1 '
              '-profile:v main -pix_fmt yuv420p -bf 0 -g 60',
        ),
        _EncoderSpec(
          name: 'libx264-ultrafast',
          args:
              '-c:v libx264 -preset ultrafast -tune fastdecode -crf $crf '
              '-threads 0 -bf 0 -g 60 -pix_fmt yuv420p',
        ),
      ];
    }
    return [
      // Many Android ffmpeg-kit builds expose MediaCodec HW encode.
      _EncoderSpec(
        name: 'h264_mediacodec',
        args:
            '-c:v h264_mediacodec -b:v $videoBitrate -maxrate $videoBitrate '
            '-bufsize $videoBitrate -pix_fmt yuv420p -bf 0 -g 60',
      ),
      _EncoderSpec(
        name: 'libx264-ultrafast',
        args:
            '-c:v libx264 -preset ultrafast -tune fastdecode -crf $crf '
            '-threads 0 -bf 0 -g 60 -pix_fmt yuv420p',
      ),
    ];
  }

  static Future<_MediaProbe> _probe(String path) async {
    int? durationMs;
    var width = 0;
    var height = 0;
    var fps = 30.0;

    try {
      final session = await FFprobeKit.getMediaInformation(path);
      final info = session.getMediaInformation();
      final rawDur = info?.getDuration();
      if (rawDur != null && rawDur.isNotEmpty) {
        final sec = double.tryParse(rawDur);
        if (sec != null && sec > 0) {
          durationMs = sec > 10000 ? sec.round() : (sec * 1000).round();
        }
      }

      final streams = info?.getStreams();
      if (streams != null) {
        for (final stream in streams) {
          final type = stream.getType()?.toLowerCase() ?? '';
          if (!type.contains('video')) continue;
          width = stream.getWidth() ?? width;
          height = stream.getHeight() ?? height;
          final avg = stream.getAverageFrameRate();
          final r = stream.getRealFrameRate();
          fps = _parseFps(avg) ?? _parseFps(r) ?? fps;
          break;
        }
      }
    } catch (_) {}

    // Even dimensions required by yuv420p — ±1px only, not a resolution change.
    if (width > 0 && width.isOdd) width -= 1;
    if (height > 0 && height.isOdd) height -= 1;

    return _MediaProbe(
      durationMs: durationMs,
      width: width,
      height: height,
      fps: fps,
    );
  }

  static double? _parseFps(String? raw) {
    if (raw == null || raw.isEmpty || raw == '0/0') return null;
    if (raw.contains('/')) {
      final parts = raw.split('/');
      if (parts.length == 2) {
        final a = double.tryParse(parts[0]);
        final b = double.tryParse(parts[1]);
        if (a != null && b != null && b != 0) return a / b;
      }
    }
    return double.tryParse(raw);
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
    final probe = await _probe(source.path);
    final profile = _profileFor(probe);

    // Keep original resolution. Only:
    //  - optional fps cap (60→30) for speed/size
    //  - even-dimension snap for H.264
    //  - lightweight watermark
    final filters = <String>[];
    if (probe.fps > 30.5) {
      filters.add('fps=${profile.fps}');
    }
    // Preserve size; force even dims without letterboxing/downscale.
    filters.add(
      "scale='trunc(iw/2)*2':'trunc(ih/2)*2':flags=fast_bilinear",
    );
    filters.add(
      "drawtext=fontfile='${_q(font)}':text='${_q(label)}':"
      "fontsize=${watermark.fontSize.clamp(18, 28)}:"
      "fontcolor=white@$alpha:$pos:box=1:boxcolor=black@0.25:boxborderw=6",
    );
    final vf = filters.join(',');

    onProgress?.call(0.02);

    final hwaccel = Platform.isIOS ? '-hwaccel videotoolbox ' : '';
    final input = _q(source.path);

    Object? lastError;
    for (final encoder in _encoderCandidates(
      videoBitrate: profile.videoBitrate,
      crf: profile.crf,
    )) {
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
          durationMs: probe.durationMs,
          onProgress: onProgress,
        );
        onProgress?.call(1.0);
        final outBytes = await file.length();
        return (
          file: file,
          width: profile.width,
          height: profile.height,
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
