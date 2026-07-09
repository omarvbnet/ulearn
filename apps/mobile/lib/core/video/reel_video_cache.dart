import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:video_player/video_player.dart';

/// Disk-cached short-video playback with prefetch dedupe and memory trimming.
class ReelVideoCache {
  ReelVideoCache._();

  static const _maxWarmControllers = 2;

  static final CacheManager _manager = CacheManager(
    Config(
      'reel_videos',
      stalePeriod: const Duration(days: 14),
      maxNrOfCacheObjects: 48,
    ),
  );

  static final Set<String> _prefetching = {};
  static final Map<String, VideoPlayerController> _warm = {};

  static String _resolve(String url) => ApiClient.absoluteUrl(url);

  /// Download to disk without blocking playback.
  static Future<void> prefetch(String url) {
    final resolved = _resolve(url);
    if (_prefetching.contains(resolved)) return Future.value();
    _prefetching.add(resolved);
    return _manager.downloadFile(resolved).whenComplete(() {
      _prefetching.remove(resolved);
    });
  }

  static void prefetchAround(List<String?> urls, int center) {
    for (var i = center - 1; i <= center + 2; i++) {
      if (i < 0 || i >= urls.length) continue;
      final url = urls[i];
      if (url != null && url.isNotEmpty) prefetch(url);
    }
  }

  /// Drop warmed controllers outside the visible window.
  static void trimWarm(Set<String> keepUrls) {
    final keep = keepUrls.map(_resolve).toSet();
    final drop = _warm.keys.where((k) => !keep.contains(k)).toList();
    for (final key in drop) {
      _warm.remove(key)?.dispose();
    }
  }

  static Future<VideoPlayerController> createController(String url) async {
    final resolved = _resolve(url);
    final existing = _warm.remove(resolved);
    if (existing != null) {
      if (existing.value.isInitialized) return existing;
      existing.dispose();
    }

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

  /// Keep a recently used controller warm for fast swipe-back.
  static void stash(String url, VideoPlayerController controller) {
    final resolved = _resolve(url);
    _warm.remove(resolved)?.dispose();
    while (_warm.length >= _maxWarmControllers) {
      final first = _warm.keys.first;
      _warm.remove(first)?.dispose();
    }
    _warm[resolved] = controller;
  }

  static void disposeAll() {
    for (final c in _warm.values) {
      c.dispose();
    }
    _warm.clear();
  }
}
