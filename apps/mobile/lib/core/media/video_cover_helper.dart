import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:video_compress/video_compress.dart';
import 'package:video_player/video_player.dart';

/// Pick or generate video cover images and read duration metadata.
class VideoCoverHelper {
  VideoCoverHelper._();

  static Future<File?> pickCoverImage() async {
    final pick = await FilePicker.pickFiles(type: FileType.image);
    if (pick == null || pick.files.isEmpty) return null;
    final file = pick.files.first;
    if (file.path != null) return File(file.path!);
    if (file.bytes != null) {
      final temp = File(
        '${Directory.systemTemp.path}/ulearn_cover_${DateTime.now().millisecondsSinceEpoch}.jpg',
      );
      await temp.writeAsBytes(file.bytes!);
      return temp;
    }
    return null;
  }

  /// Capture a frame ~1s into the video for use as cover art.
  /// Times out so large iPhone MOV files cannot hang the upload UI forever.
  static Future<File?> thumbnailFromVideo(String videoPath) async {
    try {
      final thumb = await VideoCompress.getFileThumbnail(
        videoPath,
        quality: 70,
        position: 1000,
      ).timeout(const Duration(seconds: 12));
      return thumb;
    } catch (_) {
      return null;
    }
  }

  /// Reads duration in seconds — tries video_player first, then video_compress.
  static Future<int?> videoDurationSec(String videoPath) async {
    try {
      final fromPlayer = await _durationFromPlayer(videoPath)
          .timeout(const Duration(seconds: 8));
      if (fromPlayer != null && fromPlayer > 0) return fromPlayer;
    } catch (_) {}

    try {
      final info = await VideoCompress.getMediaInfo(videoPath)
          .timeout(const Duration(seconds: 8));
      final raw = info.duration ?? 0;
      if (raw <= 0) return null;
      // video_compress returns ms on most platforms; values under ~3h are often seconds.
      if (raw > 100_000) return (raw / 1000).round();
      if (raw > 300) return (raw / 1000).round();
      return raw.round();
    } catch (_) {
      return null;
    }
  }

  static Future<int?> _durationFromPlayer(String videoPath) async {
    VideoPlayerController? controller;
    try {
      controller = VideoPlayerController.file(File(videoPath));
      await controller.initialize();
      final sec = controller.value.duration.inSeconds;
      return sec > 0 ? sec : null;
    } catch (_) {
      return null;
    } finally {
      await controller?.dispose();
    }
  }
}
