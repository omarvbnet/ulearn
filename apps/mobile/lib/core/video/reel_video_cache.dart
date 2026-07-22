import 'dart:async';

import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/video/media_cache_budget.dart';
import 'package:ulearn/core/video/video_playback.dart';
import 'package:video_player/video_player.dart';

/// Disk-cached short-video playback with warm pool + bandwidth-aware prefetch.
///
/// Size is governed by [MediaCacheBudget] (2.5 GB shared cap).
class ReelVideoCache {
  ReelVideoCache._();

  /// Keep at most one warm decoder (the *next* reel).
  static const _maxWarmControllers = 1;

  static final CacheManager manager = CacheManager(
    Config(
      'reel_videos',
      stalePeriod: const Duration(days: 7),
      maxNrOfCacheObjects: 40,
    ),
  );

  static final Set<String> _prefetching = {};
  static final Set<String> _streaming = {};
  static final Map<String, VideoPlayerController> _warm = {};
  static final Map<String, Future<VideoPlayerController>> _inflight = {};
  static final Set<String> _preparing = {};
  static int _warmEpoch = 0;

  static String _playUrl(String url) => ApiClient.absoluteUrl(url);
  static String _cacheKey(String url) => VideoPlayback.mediaCacheKey(url);

  /// Resolved cache keys currently held in the warm pool.
  static Set<String> get warmUrls => _warm.keys.toSet();

  static Future<void> emptyCache() => manager.emptyCache();

  /// Mark a URL as actively streaming so we do not also full-download it
  /// (double bandwidth is the #1 cause of mid-play stutter).
  static void beginStreaming(String url) {
    _streaming.add(_cacheKey(url));
  }

  static void endStreaming(String url) {
    _streaming.remove(_cacheKey(url));
  }

  static bool isStreaming(String url) => _streaming.contains(_cacheKey(url));

  static bool isWarmReady(String url) {
    final key = _cacheKey(url);
    final c = _warm[key];
    return c != null && c.value.isInitialized && !c.value.hasError;
  }

  static Future<bool> isFileCached(String url) async {
    if (VideoPathIndex.has(url)) return true;
    final key = _cacheKey(url);
    try {
      final info = await manager.getFileFromCache(key);
      if (info == null) return false;
      final exists = await info.file.exists();
      if (exists) VideoPathIndex.remember(url, info.file);
      return exists;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> shouldShowLoadSkeleton(String url) async {
    if (isWarmReady(url)) return false;
    if (VideoPathIndex.has(url)) return false;
    return !await isFileCached(url);
  }

  /// Full-file disk cache for upcoming reels. Skips URLs currently streaming.
  static Future<void> prefetch(String url) async {
    final playUrl = _playUrl(url);
    final key = _cacheKey(url);
    if (_prefetching.contains(key)) return;
    if (_streaming.contains(key)) return;
    if (VideoPathIndex.has(url)) return;
    if (!await MediaCacheBudget.canPrefetch()) return;

    _prefetching.add(key);
    try {
      final existing = await manager.getFileFromCache(key);
      if (existing != null && await existing.file.exists()) {
        VideoPathIndex.remember(url, existing.file);
        return;
      }
      // Download with the live signed URL, store under the stable object key.
      final file = await manager.downloadFile(playUrl, key: key);
      VideoPathIndex.remember(url, file.file);
      await MediaCacheBudget.enforce();
    } catch (_) {
      // Prefetch is best-effort.
    } finally {
      _prefetching.remove(key);
    }
  }

  /// Disk-prefetch the next reel only. Decoder warm is owned by [ReelPage]
  /// keepWarm (paused controllers in the ±1 window) — avoids a second
  /// network decoder racing the active stream.
  static void prefetchAround(List<String?> urls, int center) {
    _warmEpoch++;
    final epoch = _warmEpoch;

    if (center + 1 >= urls.length) return;
    final next = urls[center + 1];
    if (next == null || next.isEmpty) return;

    unawaited(
      Future<void>.delayed(const Duration(milliseconds: 500), () async {
        if (epoch != _warmEpoch) return;
        await prefetch(next);
      }),
    );

    // Also quietly fill previous for swipe-back file hits.
    if (center - 1 >= 0) {
      final prev = urls[center - 1];
      if (prev != null && prev.isNotEmpty) {
        unawaited(
          Future<void>.delayed(const Duration(milliseconds: 1200), () async {
            if (epoch != _warmEpoch) return;
            await prefetch(prev);
          }),
        );
      }
    }
  }

  /// Initialize and stash the next reel so the swipe feels instant.
  static void prepareWarm(String url) {
    final key = _cacheKey(url);
    if (_warm.containsKey(key) ||
        _inflight.containsKey(key) ||
        _preparing.contains(key) ||
        _streaming.contains(key)) {
      return;
    }
    _preparing.add(key);
    () async {
      try {
        // Prefer a fully cached file for warm controllers — avoids another
        // network stream competing with the active reel.
        final cached = await isFileCached(url);
        if (!cached && _streaming.isNotEmpty) {
          // Active reel is streaming and next isn't on disk yet — skip warm;
          // disk prefetch will catch up and the next swipe can still stream.
          return;
        }
        final c = await _createFresh(url, forWarm: true);
        await VideoPlayback.initializeSafely(c, urlForCacheInvalidation: url);
        if (!c.value.isInitialized || c.value.hasError) {
          await releaseController(c);
          return;
        }
        c.setLooping(false);
        c.setVolume(0);
        await c.play();
        await Future<void>.delayed(const Duration(milliseconds: 40));
        await c.pause();
        try {
          await c.seekTo(Duration.zero);
        } catch (_) {}
        stash(url, c);
      } catch (_) {
        // Ignore warm failures; playback will retry on demand.
      } finally {
        _preparing.remove(key);
      }
    }();
  }

  static void trimWarm(Set<String> keepUrls) {
    final keep = keepUrls.map(_cacheKey).toSet();
    final drop = _warm.keys.where((k) => !keep.contains(k)).toList();
    for (final key in drop) {
      final c = _warm.remove(key);
      if (c != null) releaseController(c);
    }
  }

  static Future<VideoPlayerController> createController(String url) async {
    final key = _cacheKey(url);
    beginStreaming(url);

    final warmed = _warm.remove(key);
    if (warmed != null) {
      if (warmed.value.isInitialized && !warmed.value.hasError) {
        return warmed;
      }
      await releaseController(warmed);
    }

    final pending = _inflight[key];
    if (pending != null) return pending;

    final future = _createFresh(url, forWarm: false);
    _inflight[key] = future;
    try {
      return await future;
    } finally {
      _inflight.remove(key);
    }
  }

  static Future<VideoPlayerController> _createFresh(
    String url, {
    required bool forWarm,
  }) async {
    final playUrl = _playUrl(url);
    final key = _cacheKey(url);

    final indexed = VideoPathIndex.fileFor(url);
    if (indexed != null) {
      return VideoPlayback.create(playUrl, file: indexed);
    }

    try {
      final info = await manager.getFileFromCache(key);
      if (info != null && await info.file.exists()) {
        VideoPathIndex.remember(url, info.file);
        try {
          await info.file.setLastModified(DateTime.now());
        } catch (_) {}
        return VideoPlayback.create(playUrl, file: info.file);
      }
    } catch (_) {}

    // Progressive network — never full-download this URL in parallel.
    if (forWarm) {
      unawaited(prefetch(url));
    }
    return VideoPlayback.create(playUrl);
  }

  static void stash(String url, VideoPlayerController controller) {
    if (controller.value.hasError) {
      releaseController(controller);
      return;
    }
    final key = _cacheKey(url);
    endStreaming(url);
    final previous = _warm.remove(key);
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
    _warm[key] = controller;
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

  static void releaseWarm() {
    _warmEpoch++;
    for (final c in _warm.values) {
      releaseController(c);
    }
    _warm.clear();
    _preparing.clear();
    _streaming.clear();
    _prefetching.clear();
    _inflight.clear();
  }
}
