import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:video_player/video_player.dart';

/// Disk-cached course lesson playback (3-day retention).
class CourseVideoCache {
  CourseVideoCache._();

  static final CacheManager _manager = CacheManager(
    Config(
      'course_videos',
      stalePeriod: const Duration(days: 3),
      maxNrOfCacheObjects: 32,
    ),
  );

  static final Set<String> _prefetching = {};

  static String _resolve(String url) => ApiClient.absoluteUrl(url);

  static Future<bool> isFileCached(String url) async {
    final resolved = _resolve(url);
    try {
      final info = await _manager.getFileFromCache(resolved);
      if (info == null) return false;
      return info.file.exists();
    } catch (_) {
      return false;
    }
  }

  static Future<void> prefetch(String url) {
    final resolved = _resolve(url);
    if (_prefetching.contains(resolved)) return Future.value();
    _prefetching.add(resolved);
    return _manager.downloadFile(resolved).whenComplete(() {
      _prefetching.remove(resolved);
    });
  }

  static Future<VideoPlayerController> createController(String url) async {
    final resolved = _resolve(url);
    try {
      final file = await _manager.getSingleFile(resolved);
      return VideoPlayerController.file(
        file,
        videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
      );
    } catch (_) {
      return VideoPlayerController.networkUrl(
        Uri.parse(resolved),
        videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
      );
    }
  }
}
