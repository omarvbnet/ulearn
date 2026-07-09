import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:video_compress/video_compress.dart';

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
  static Future<File?> thumbnailFromVideo(String videoPath) async {
    try {
      final thumb = await VideoCompress.getFileThumbnail(
        videoPath,
        quality: 80,
        position: 1000,
      );
      return thumb;
    } catch (_) {
      return null;
    }
  }

  static Future<int?> videoDurationSec(String videoPath) async {
    try {
      final info = await VideoCompress.getMediaInfo(videoPath);
      final ms = info.duration ?? 0;
      if (ms <= 0) return null;
      return (ms / 1000).round();
    } catch (_) {
      return null;
    }
  }
}
