import 'dart:io';

import 'package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart';
import 'package:ffmpeg_kit_flutter_new/return_code.dart';
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

/// Client-side FFmpeg: single 1080p H.264/AAC MP4 with burned watermark + faststart.
class VideoProcessService {
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

  static Future<({File file, int? width, int? height})> processForUpload({
    required File source,
    required VideoWatermarkSettings watermark,
    void Function(double progress)? onProgress,
  }) async {
    final dir = await getTemporaryDirectory();
    final outPath =
        '${dir.path}/ulearn_delivery_${DateTime.now().millisecondsSinceEpoch}.mp4';
    final label = watermark.buildLabel();
    final font = _fontPath();
    final pos = _positionExpr(watermark.position);
    final alpha = watermark.opacity.clamp(0.1, 1.0).toStringAsFixed(2);

    final vf =
        "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,"
        "drawtext=fontfile='$font':text='$label':fontsize=${watermark.fontSize}:"
        "fontcolor=white@$alpha:$pos:box=1:boxcolor=black@0.25:boxborderw=8";

    final cmd =
        "-y -i '${source.path}' -vf \"$vf\" -c:v libx264 -preset medium -crf 23 "
        "-c:a aac -b:a 128k -movflags +faststart '$outPath'";

    onProgress?.call(0.05);

    final session = await FFmpegKit.execute(cmd);
    final code = await session.getReturnCode();

    if (!ReturnCode.isSuccess(code)) {
      final logs = await session.getAllLogsAsString();
      throw Exception('Video processing failed: ${logs ?? 'unknown error'}');
    }

    final out = File(outPath);
    if (!await out.exists() || await out.length() <= 0) {
      throw Exception('Processed video file missing');
    }

    onProgress?.call(1.0);
    return (file: out, width: 1920, height: 1080);
  }
}
