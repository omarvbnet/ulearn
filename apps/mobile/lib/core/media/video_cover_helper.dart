import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:video_compress/video_compress.dart';
import 'package:video_player/video_player.dart';

/// Pick or generate video cover images and read duration metadata.
class VideoCoverHelper {
  VideoCoverHelper._();

  static Future<File?> pickCoverImage() async {
    final pick = await FilePicker.pickFiles(type: FileType.image);
    if (pick == null || pick.files.isEmpty) return null;
    final file = pick.files.first;
    if (file.path != null) {
      // Copy out of picker/temp so later cache cleanup cannot delete it.
      return _persistCover(File(file.path!));
    }
    if (file.bytes != null) {
      final temp = await _coverDestPath('jpg');
      await temp.writeAsBytes(file.bytes!);
      return temp;
    }
    return null;
  }

  /// Capture a frame ~1s into the video for use as cover art.
  ///
  /// Copies the frame out of `video_compress` cache into a stable
  /// `ulearn_cover_*.jpg` path — otherwise [VideoCompress.deleteAllCache]
  /// (or mid-upload temp cleanup) deletes the cover before it is uploaded.
  static Future<File?> thumbnailFromVideo(String videoPath) async {
    try {
      final thumb = await VideoCompress.getFileThumbnail(
        videoPath,
        quality: 70,
        position: 1000,
      ).timeout(const Duration(seconds: 12));
      return _persistCover(thumb);
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

  /// Ensure [cover] is not inside the volatile `video_compress` cache.
  /// Safe to call right before uploading an existing cover file.
  static Future<File> ensurePersistedCover(File cover) async {
    final path = cover.path;
    if (path.contains('ulearn_cover_')) return cover;
    if (path.contains('video_compress') || path.contains('VideoCompress')) {
      return _persistCover(cover);
    }
    return cover;
  }

  static Future<File> _coverDestPath(String ext) async {
    final dir = await getTemporaryDirectory();
    return File(
      '${dir.path}/ulearn_cover_${DateTime.now().microsecondsSinceEpoch}.$ext',
    );
  }

  static Future<File> _persistCover(File source) async {
    final lower = source.path.toLowerCase();
    final ext = lower.endsWith('.png')
        ? 'png'
        : lower.endsWith('.webp')
            ? 'webp'
            : 'jpg';
    final dest = await _coverDestPath(ext);
    // Already our stable path — reuse.
    if (source.path.contains('ulearn_cover_')) return source;
    try {
      return await source.copy(dest.path);
    } catch (_) {
      // Fallback: read bytes if copy fails across volumes.
      final bytes = await source.readAsBytes();
      await dest.writeAsBytes(bytes, flush: true);
      return dest;
    }
  }
}
