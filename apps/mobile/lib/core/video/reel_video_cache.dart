import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:video_player/video_player.dart';

/// Disk-cached short-video playback for smoother reels scrolling.
class ReelVideoCache {
  ReelVideoCache._();

  static final DefaultCacheManager _manager = DefaultCacheManager();

  static String _resolve(String url) => ApiClient.absoluteUrl(url);

  static Future<VideoPlayerController> createController(String url) async {
    final resolved = _resolve(url);
    try {
      final file = await _manager.getSingleFile(resolved);
      return VideoPlayerController.file(file);
    } catch (_) {
      return VideoPlayerController.networkUrl(Uri.parse(resolved));
    }
  }

  static Future<void> prefetch(String url) async {
    try {
      await _manager.downloadFile(_resolve(url));
    } catch (_) {}
  }
}
