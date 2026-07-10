import 'dart:async';
import 'dart:io';

import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:path_provider/path_provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/video/course_video_cache.dart';
import 'package:ulearn/core/video/image_cache_manager.dart';
import 'package:ulearn/core/video/reel_video_cache.dart';
import 'package:ulearn/core/video/video_playback.dart';

/// Unified disk budget for course videos, shorts, and images.
///
/// Hard cap: 2.5 GB. Soft target: ~2.0 GB after eviction so playback can
/// keep prefetching without immediately hitting the ceiling again.
///
/// Eviction order (smart for video UX):
/// 1. Images (cheap to re-fetch)
/// 2. Oldest course lesson files
/// 3. Oldest short/reel files
/// Never deletes files for [pin]ned URLs or warm reel controllers.
class MediaCacheBudget {
  MediaCacheBudget._();

  static const int maxBytes = 2684354560; // 2.5 GiB
  static const int softBytes = 2147483648; // 2.0 GiB target after trim
  static const int prefetchGateBytes = 2415919104; // ~2.25 GiB — pause non-critical prefetch

  static const _buckets = <_CacheBucket>[
    _CacheBucket(key: 'ulearn_images', kind: _CacheKind.image),
    _CacheBucket(key: 'libCachedImageData', kind: _CacheKind.image),
    _CacheBucket(key: 'course_videos', kind: _CacheKind.course),
    _CacheBucket(key: 'reel_videos', kind: _CacheKind.reel),
  ];

  static final Set<String> _pinnedUrls = {};
  static Future<void>? _enforceInflight;
  static DateTime? _lastEnforceAt;

  static void pin(String url) {
    final resolved = ApiClient.absoluteUrl(url);
    if (resolved.isNotEmpty) _pinnedUrls.add(resolved);
  }

  static void unpin(String url) {
    _pinnedUrls.remove(ApiClient.absoluteUrl(url));
  }

  static void pinMany(Iterable<String> urls) {
    for (final u in urls) {
      pin(u);
    }
  }

  /// True when background prefetch should run (under soft gate).
  static Future<bool> canPrefetch() async {
    final used = await usageBytes();
    if (used < prefetchGateBytes) return true;
    await enforce();
    return await usageBytes() < prefetchGateBytes;
  }

  static Future<int> usageBytes() async {
    var total = 0;
    for (final entry in await _listCacheFiles()) {
      total += entry.size;
    }
    return total;
  }

  static Future<String> formatUsage() async {
    final bytes = await usageBytes();
    return formatBytes(bytes);
  }

  static String formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(0)} KB';
    }
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  /// Run after downloads / on app start. Debounced; concurrent calls share one run.
  static Future<void> enforce({bool force = false}) {
    final now = DateTime.now();
    if (!force &&
        _lastEnforceAt != null &&
        now.difference(_lastEnforceAt!) < const Duration(seconds: 4) &&
        _enforceInflight == null) {
      return Future.value();
    }
    return _enforceInflight ??= _enforceInternal().whenComplete(() {
      _enforceInflight = null;
      _lastEnforceAt = DateTime.now();
    });
  }

  static Future<void> clearAll() async {
    VideoPathIndex.clear();
    await Future.wait([
      CourseVideoCache.emptyCache(),
      ReelVideoCache.emptyCache(),
      UlearnImageCache.emptyCache(),
      DefaultCacheManager().emptyCache(),
    ]);
    // Sweep any leftover files under known dirs.
    final base = await getTemporaryDirectory();
    for (final bucket in _buckets) {
      final dir = Directory('${base.path}/${bucket.key}');
      if (await dir.exists()) {
        try {
          await dir.delete(recursive: true);
        } catch (_) {}
      }
    }
  }

  static Future<void> _enforceInternal() async {
    final used = await usageBytes();
    if (used <= maxBytes) return;

    final protected = await _protectedFilePaths();
    final files = await _listCacheFiles();
    // Evict images first, then oldest course, then oldest reels.
    files.sort((a, b) {
      final kindCmp = a.kind.evictOrder.compareTo(b.kind.evictOrder);
      if (kindCmp != 0) return kindCmp;
      return a.modified.compareTo(b.modified);
    });

    var remaining = used;
    for (final entry in files) {
      if (remaining <= softBytes) break;
      if (protected.contains(entry.path)) continue;
      try {
        final f = File(entry.path);
        if (await f.exists()) {
          await f.delete();
          remaining -= entry.size;
        }
      } catch (_) {}
    }

    // If still over hard cap (everything left is protected), drop oldest
    // unprotected again targeting hard max only.
    if (remaining > maxBytes) {
      final again = await _listCacheFiles();
      again.sort((a, b) => a.modified.compareTo(b.modified));
      for (final entry in again) {
        if (remaining <= maxBytes) break;
        if (protected.contains(entry.path)) continue;
        try {
          final f = File(entry.path);
          if (await f.exists()) {
            await f.delete();
            remaining -= entry.size;
          }
        } catch (_) {}
      }
    }
  }

  static Future<Set<String>> _protectedFilePaths() async {
    final paths = <String>{};
    final urls = <String>{
      ..._pinnedUrls,
      ...ReelVideoCache.warmUrls,
    };
    final managers = <CacheManager>[
      CourseVideoCache.manager,
      ReelVideoCache.manager,
      UlearnImageCache.manager,
    ];
    for (final url in urls) {
      for (final manager in managers) {
        try {
          final info = await manager.getFileFromCache(url);
          if (info != null) {
            paths.add(info.file.absolute.path);
          }
        } catch (_) {}
      }
    }
    return paths;
  }

  static Future<List<_CacheFile>> _listCacheFiles() async {
    final base = await getTemporaryDirectory();
    final out = <_CacheFile>[];
    for (final bucket in _buckets) {
      final dir = Directory('${base.path}/${bucket.key}');
      if (!await dir.exists()) continue;
      await for (final entity in dir.list(recursive: true, followLinks: false)) {
        if (entity is! File) continue;
        try {
          final stat = await entity.stat();
          if (stat.size <= 0) continue;
          // Skip tiny metadata / db sidecars if any.
          final name = entity.uri.pathSegments.isNotEmpty
              ? entity.uri.pathSegments.last
              : '';
          if (name.endsWith('.db') || name.endsWith('.db-journal')) continue;
          out.add(
            _CacheFile(
              path: entity.absolute.path,
              size: stat.size,
              modified: stat.modified,
              kind: bucket.kind,
            ),
          );
        } catch (_) {}
      }
    }
    return out;
  }
}

enum _CacheKind {
  image(0),
  course(1),
  reel(2);

  const _CacheKind(this.evictOrder);
  final int evictOrder;
}

class _CacheBucket {
  const _CacheBucket({required this.key, required this.kind});
  final String key;
  final _CacheKind kind;
}

class _CacheFile {
  const _CacheFile({
    required this.path,
    required this.size,
    required this.modified,
    required this.kind,
  });
  final String path;
  final int size;
  final DateTime modified;
  final _CacheKind kind;
}
