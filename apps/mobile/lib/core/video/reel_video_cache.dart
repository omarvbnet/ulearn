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

  /// Active + next is enough; more decoders stack and leave reels stuck loading.
  static const _maxWarmControllers = 1;

  static final CacheManager manager = CacheManager(
    Config(
      'reel_videos',
      stalePeriod: const Duration(days: 7),
      maxNrOfCacheObjects: 36,
    ),
  );

  static final Set<String> _prefetching = {};
  static final Set<String> _streaming = {};
  static final Map<String, VideoPlayerController> _warm = {};
  static final Map<String, Future<VideoPlayerController>> _inflight = {};
  static final Set<String> _preparing = {};

  static String _resolve(String url) => ApiClient.absoluteUrl(url);

  /// Resolved URLs currently held in the warm pool (protected from eviction).
  static Set<String> get warmUrls => _warm.keys.toSet();

  static Future<void> emptyCache() => manager.emptyCache();

  /// Mark a URL as actively streaming so we do not also full-download it
  /// (double bandwidth is the #1 cause of mid-play stutter).
  static void beginStreaming(String url) {
    _streaming.add(_resolve(url));
  }

  static void endStreaming(String url) {
    _streaming.remove(_resolve(url));
  }

  static bool isWarmReady(String url) {
    final resolved = _resolve(url);
    final c = _warm[resolved];
    return c != null && c.value.isInitialized && !c.value.hasError;
  }

  static Future<bool> isFileCached(String url) async {
    if (VideoPathIndex.has(url)) return true;
    final resolved = _resolve(url);
    try {
      final info = await manager.getFileFromCache(resolved);
      if (info == null) return false;
      final exists = await info.file.exists();
      if (exists) VideoPathIndex.remember(resolved, info.file);
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
    final resolved = _resolve(url);
    if (_prefetching.contains(resolved)) return;
    if (_streaming.contains(resolved)) return;
    if (VideoPathIndex.has(resolved)) return;
    if (!await MediaCacheBudget.canPrefetch()) return;

    _prefetching.add(resolved);
    try {
      final existing = await manager.getFileFromCache(resolved);
      if (existing != null && await existing.file.exists()) {
        VideoPathIndex.remember(resolved, existing.file);
        return;
      }
      final file = await manager.downloadFile(resolved);
      VideoPathIndex.remember(resolved, file.file);
      await MediaCacheBudget.enforce();
    } catch (_) {
      // Prefetch is best-effort.
    } finally {
      _prefetching.remove(resolved);
    }
  }

  /// Prefetch disk for neighbors; warm-init only the *next* reel.
  static void prefetchAround(List<String?> urls, int center) {
    // Disk: previous + next (not current — current is streaming).
    for (final i in [center - 1, center + 1, center + 2]) {
      if (i < 0 || i >= urls.length || i == center) continue;
      final url = urls[i];
      if (url != null && url.isNotEmpty) unawaited(prefetch(url));
    }
    // Decoder warm: only the immediate next for instant swipe.
    if (center + 1 < urls.length) {
      final next = urls[center + 1];
      if (next != null && next.isNotEmpty) prepareWarm(next);
    }
  }

  /// Initialize and stash the next reel so the swipe feels instant.
  static void prepareWarm(String url) {
    final resolved = _resolve(url);
    if (_warm.containsKey(resolved) ||
        _inflight.containsKey(resolved) ||
        _preparing.contains(resolved) ||
        _streaming.isNotEmpty) {
      // Never warm while something is actively streaming — that stacks
      // decoders and is the main cause of endless loading spinners.
      return;
    }
    _preparing.add(resolved);
    () async {
      try {
        final c = await _createFresh(resolved, forWarm: true);
        await VideoPlayback.initializeSafely(c, urlForCacheInvalidation: resolved);
        if (!c.value.isInitialized || c.value.hasError) {
          await releaseController(c);
          return;
        }
        c.setLooping(true);
        c.setVolume(0);
        // Decode a few frames into the texture, then pause — first paint is ready.
        await c.play();
        await Future<void>.delayed(const Duration(milliseconds: 48));
        await c.pause();
        try {
          await c.seekTo(Duration.zero);
        } catch (_) {}
        stash(url, c);
      } catch (_) {
        // Ignore warm failures; playback will retry on demand.
      } finally {
        _preparing.remove(resolved);
      }
    }();
  }

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
    beginStreaming(resolved);

    final warmed = _warm.remove(resolved);
    if (warmed != null) {
      if (warmed.value.isInitialized && !warmed.value.hasError) {
        return warmed;
      }
      await releaseController(warmed);
    }

    final pending = _inflight[resolved];
    if (pending != null) return pending;

    final future = _createFresh(resolved, forWarm: false);
    _inflight[resolved] = future;
    try {
      return await future;
    } finally {
      _inflight.remove(resolved);
    }
  }

  static Future<VideoPlayerController> _createFresh(
    String resolved, {
    required bool forWarm,
  }) async {
    // Sync path first — zero async gap for first frame.
    final indexed = VideoPathIndex.fileFor(resolved);
    if (indexed != null) {
      return VideoPlayback.create(resolved, file: indexed);
    }

    try {
      final info = await manager.getFileFromCache(resolved);
      if (info != null && await info.file.exists()) {
        VideoPathIndex.remember(resolved, info.file);
        try {
          await info.file.setLastModified(DateTime.now());
        } catch (_) {}
        return VideoPlayback.create(resolved, file: info.file);
      }
    } catch (_) {}

    // Progressive network play. Never full-download the same URL while streaming.
    // Warm controllers may kick off a quiet disk prefetch for later.
    if (forWarm) {
      unawaited(prefetch(resolved));
    }
    return VideoPlayback.create(resolved);
  }

  static void stash(String url, VideoPlayerController controller) {
    if (controller.value.hasError) {
      releaseController(controller);
      return;
    }
    final resolved = _resolve(url);
    endStreaming(resolved);
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

  static void releaseWarm() {
    for (final c in _warm.values) {
      releaseController(c);
    }
    _warm.clear();
    _preparing.clear();
    _streaming.clear();
  }
}
