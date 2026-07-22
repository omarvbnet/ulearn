import 'dart:async';

import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/video/media_cache_budget.dart';
import 'package:ulearn/core/video/video_playback.dart';
import 'package:video_player/video_player.dart';
import 'dart:io';

/// Disk-cached course lesson playback with progressive start + smart prefetch.
///
/// Cold start streams over the network immediately. Disk cache fills in the
/// background for *other* lessons — never the one currently streaming.
class CourseVideoCache {
  CourseVideoCache._();

  static final CacheManager manager = CacheManager(
    Config(
      'course_videos',
      stalePeriod: const Duration(days: 7),
      maxNrOfCacheObjects: 24,
    ),
  );

  static final Set<String> _prefetching = {};
  static final Set<String> _streaming = {};

  static String _playUrl(String url) => ApiClient.absoluteUrl(url);
  static String _cacheKey(String url) => VideoPlayback.mediaCacheKey(url);

  static Future<void> emptyCache() => manager.emptyCache();

  static void beginStreaming(String url) => _streaming.add(_cacheKey(url));

  static void endStreaming(String url) => _streaming.remove(_cacheKey(url));

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

  /// Download to disk without blocking playback. Skips actively streaming URLs.
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
      final file = await manager.downloadFile(playUrl, key: key);
      VideoPathIndex.remember(url, file.file);
      await MediaCacheBudget.enforce();
    } catch (_) {
    } finally {
      _prefetching.remove(key);
    }
  }

  /// Prefetch the *next* lesson only (never the active one while it streams).
  static void prefetchAround(List<String?> urls, int center) {
    final next = center + 1;
    if (next < 0 || next >= urls.length) return;
    final url = urls[next];
    if (url != null && url.isNotEmpty) unawaited(prefetch(url));
  }

  /// Prefer a cached file when available; otherwise stream immediately.
  ///
  /// When [initialize] is true, uses [VideoPlayback.open] (GET/Range + optional
  /// URL refresh + bounded GET-to-disk). Never probes with HEAD — R2 SigV4
  /// signed URLs return 403 on HEAD.
  static Future<VideoPlayerController> createController(
    String url, {
    Future<String?> Function()? refreshUrl,
    bool initialize = false,
  }) async {
    final playUrl = _playUrl(url);
    final key = _cacheKey(url);
    beginStreaming(url);

    Future<VideoPlayerController?> tryFile(File file) async {
      final c = VideoPlayback.create(playUrl, file: file);
      if (!initialize) return c;
      try {
        await VideoPlayback.initializeSafely(c, urlForCacheInvalidation: url);
        return c;
      } catch (_) {
        try {
          await c.dispose();
        } catch (_) {}
        VideoPathIndex.remove(url);
        return null;
      }
    }

    final indexed = VideoPathIndex.fileFor(url);
    if (indexed != null) {
      final hit = await tryFile(indexed);
      if (hit != null) return hit;
    }

    try {
      final info = await manager.getFileFromCache(key);
      if (info != null && await info.file.exists()) {
        VideoPathIndex.remember(url, info.file);
        try {
          await info.file.setLastModified(DateTime.now());
        } catch (_) {}
        final hit = await tryFile(info.file);
        if (hit != null) return hit;
      }
    } catch (_) {}

    if (initialize) {
      return VideoPlayback.open(
        playUrl,
        refreshUrl: refreshUrl,
        // Large lessons must stream via fvp Range — full GET fallback hangs UI.
        allowDownloadFallback: false,
      );
    }
    // Progressive network — do NOT full-download this URL in parallel.
    return VideoPlayback.create(playUrl);
  }

  /// After playback is healthy, quietly cache this lesson for next open.
  static void cacheAfterPlay(String url) {
    final key = _cacheKey(url);
    // Defer so we don't compete with the first few seconds of buffering.
    Future<void>.delayed(const Duration(seconds: 8), () {
      if (_streaming.contains(key)) {
        // Still on this lesson — wait until they leave, or skip.
        return;
      }
      unawaited(prefetch(url));
    });
  }

  static void onPlaybackEnded(String url) {
    endStreaming(url);
    // Now safe to fill disk cache for revisit.
    unawaited(prefetch(url));
  }
}
