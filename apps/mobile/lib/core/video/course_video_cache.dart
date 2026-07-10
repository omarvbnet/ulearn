import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:video_player/video_player.dart';

/// Disk-cached course lesson playback (3-day retention).
///
/// Cold start streams over the network immediately (like web `<video>`).
/// A background download fills the disk cache for the next open.
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

  /// Download to disk without blocking playback.
  static Future<void> prefetch(String url) {
    final resolved = _resolve(url);
    if (_prefetching.contains(resolved)) return Future.value();
    _prefetching.add(resolved);
    return _manager.downloadFile(resolved).whenComplete(() {
      _prefetching.remove(resolved);
    });
  }

  /// Prefetch only the active lesson and the next one (avoids bandwidth fights).
  static void prefetchAround(List<String?> urls, int center) {
    for (final i in [center, center + 1]) {
      if (i < 0 || i >= urls.length) continue;
      final url = urls[i];
      if (url != null && url.isNotEmpty) prefetch(url);
    }
  }

  /// Prefer a cached file when available; otherwise stream immediately.
  static Future<VideoPlayerController> createController(String url) async {
    final resolved = _resolve(url);
    try {
      final info = await _manager.getFileFromCache(resolved);
      if (info != null && await info.file.exists()) {
        return VideoPlayerController.file(
          info.file,
          videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
        );
      }
    } catch (_) {}

    // Do not await a full download — start progressive playback like the web.
    prefetch(url);
    return VideoPlayerController.networkUrl(
      Uri.parse(resolved),
      videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
    );
  }
}
