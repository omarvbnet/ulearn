import 'dart:async';

import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/video/media_cache_budget.dart';
import 'package:ulearn/core/video/video_playback.dart';
import 'package:video_player/video_player.dart';

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

  static String _resolve(String url) => ApiClient.absoluteUrl(url);

  static Future<void> emptyCache() => manager.emptyCache();

  static void beginStreaming(String url) => _streaming.add(_resolve(url));

  static void endStreaming(String url) => _streaming.remove(_resolve(url));

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

  /// Download to disk without blocking playback. Skips actively streaming URLs.
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
    } finally {
      _prefetching.remove(resolved);
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
  static Future<VideoPlayerController> createController(String url) async {
    final resolved = _resolve(url);
    beginStreaming(resolved);

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

    // Progressive network — do NOT full-download this URL in parallel.
    return VideoPlayback.create(resolved);
  }

  /// After playback is healthy, quietly cache this lesson for next open.
  static void cacheAfterPlay(String url) {
    final resolved = _resolve(url);
    // Defer so we don't compete with the first few seconds of buffering.
    Future<void>.delayed(const Duration(seconds: 8), () {
      if (_streaming.contains(resolved)) {
        // Still on this lesson — wait until they leave, or skip.
        return;
      }
      unawaited(prefetch(resolved));
    });
  }

  static void onPlaybackEnded(String url) {
    endStreaming(url);
    // Now safe to fill disk cache for revisit.
    unawaited(prefetch(url));
  }
}
