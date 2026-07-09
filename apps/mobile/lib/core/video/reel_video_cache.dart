import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:video_player/video_player.dart';

/// Disk-cached short-video playback with deduped init, warm pool, and safe release.
class ReelVideoCache {
  ReelVideoCache._();

  static const _maxWarmControllers = 3;

  static final CacheManager _manager = CacheManager(
    Config(
      'reel_videos',
      stalePeriod: const Duration(days: 14),
      maxNrOfCacheObjects: 48,
    ),
  );

  static final Set<String> _prefetching = {};
  static final Map<String, VideoPlayerController> _warm = {};
  static final Map<String, Future<VideoPlayerController>> _inflight = {};
  static final Set<String> _preparing = {};

  static String _resolve(String url) => ApiClient.absoluteUrl(url);

  /// Warm pool already has an initialized controller for this URL.
  static bool isWarmReady(String url) {
    final resolved = _resolve(url);
    final c = _warm[resolved];
    return c != null && c.value.isInitialized && !c.value.hasError;
  }

  /// True when the video file is already on disk (no network fetch needed).
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

  /// Show a loading skeleton only when neither warm nor disk cache is available.
  static Future<bool> shouldShowLoadSkeleton(String url) async {
    if (isWarmReady(url)) return false;
    return !await isFileCached(url);
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

  static void prefetchAround(List<String?> urls, int center) {
    for (var i = center - 1; i <= center + 2; i++) {
      if (i < 0 || i >= urls.length) continue;
      final url = urls[i];
      if (url != null && url.isNotEmpty) {
        prefetch(url);
        if (i == center + 1 || i == center + 2) {
          prepareWarm(url);
        }
      }
    }
  }

  /// Initialize and stash the next reel so the swipe feels instant.
  static void prepareWarm(String url) {
    final resolved = _resolve(url);
    if (_warm.containsKey(resolved) ||
        _inflight.containsKey(resolved) ||
        _preparing.contains(resolved)) {
      return;
    }
    _preparing.add(resolved);
    () async {
      try {
        final c = await _createFresh(resolved);
        await c.initialize();
        if (!c.value.isInitialized || c.value.hasError) {
          await releaseController(c);
          return;
        }
        c.setLooping(true);
        c.setVolume(0);
        c.pause();
        stash(url, c);
      } catch (_) {
        // Ignore warm failures; playback will retry on demand.
      } finally {
        _preparing.remove(resolved);
      }
    }();
  }

  /// Drop warmed controllers outside the visible window.
  static void trimWarm(Set<String> keepUrls) {
    final keep = keepUrls.map(_resolve).toSet();
    final drop = _warm.keys.where((k) => !keep.contains(k)).toList();
    for (final key in drop) {
      final c = _warm.remove(key);
      if (c != null) releaseController(c);
    }
  }

  static Future<VideoPlayerController> createController(String url) async {
    final resolved = _resolve(url);

    final warmed = _warm.remove(resolved);
    if (warmed != null) {
      if (warmed.value.isInitialized && !warmed.value.hasError) {
        return warmed;
      }
      await releaseController(warmed);
    }

    final pending = _inflight[resolved];
    if (pending != null) return pending;

    final future = _createFresh(resolved);
    _inflight[resolved] = future;
    try {
      return await future;
    } finally {
      _inflight.remove(resolved);
    }
  }

  static Future<VideoPlayerController> _createFresh(String resolved) async {
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
    if (controller.value.hasError) {
      releaseController(controller);
      return;
    }
    final resolved = _resolve(url);
    final previous = _warm.remove(resolved);
    if (previous != null && !identical(previous, controller)) {
      releaseController(previous);
    }
    while (_warm.length >= _maxWarmControllers) {
      final first = _warm.keys.first;
      final c = _warm.remove(first);
      if (c != null) releaseController(c);
    }
    try {
      controller.pause();
      controller.setVolume(0);
    } catch (_) {}
    _warm[resolved] = controller;
  }

  static Future<void> releaseController(VideoPlayerController? controller) async {
    if (controller == null) return;
    try {
      if (controller.value.isInitialized) {
        await controller.pause();
      }
    } catch (_) {}
    try {
      controller.dispose();
    } catch (_) {}
  }

  /// Clears only the warm pool. Active controllers stay owned by [ReelPage].
  static void releaseWarm() {
    for (final c in _warm.values) {
      releaseController(c);
    }
    _warm.clear();
    _preparing.clear();
  }
}
