import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:video_player/video_player.dart';

/// Shared, high-performance [VideoPlayerController] factory.
///
/// Backed by **fvp** (libmdk) hardware decode on iOS/Android when registered
/// in `main()`. Prefers local files from [VideoPathIndex] for instant start.
class VideoPlayback {
  VideoPlayback._();

  static final videoPlayerOptions = VideoPlayerOptions(
    mixWithOthers: true,
    allowBackgroundPlayback: false,
  );

  /// How long [initialize] may take before we abort and retry.
  static const initTimeout = Duration(seconds: 12);

  /// Stable disk-cache key. R2/S3 signed URLs change query params every
  /// request — stripping them lets the same object reuse a cached file.
  static String mediaCacheKey(String url) {
    final resolved = ApiClient.absoluteUrl(url);
    final uri = Uri.tryParse(resolved);
    if (uri == null || !uri.hasScheme) return resolved;
    final q = uri.queryParameters;
    final signed = q.containsKey('X-Amz-Signature') ||
        q.containsKey('X-Amz-Algorithm') ||
        q.containsKey('x-amz-signature') ||
        q.containsKey('Signature') ||
        q.containsKey('X-Amz-Credential');
    if (signed) {
      return uri.replace(query: '', fragment: '').toString();
    }
    return resolved;
  }

  /// Build an optimized controller. Uses disk path when known/cached.
  ///
  /// Avoid custom HTTP headers on signed R2 URLs — SigV4 URLs only sign
  /// `host`, and extra headers have caused players to hang on buffering.
  static VideoPlayerController create(String url, {File? file}) {
    final resolved = ApiClient.absoluteUrl(url);
    final local = file ?? VideoPathIndex.fileFor(resolved);
    if (local != null) {
      try {
        if (local.existsSync()) {
          return VideoPlayerController.file(
            local,
            videoPlayerOptions: videoPlayerOptions,
          );
        }
      } catch (_) {}
      VideoPathIndex.remove(resolved);
    }

    return VideoPlayerController.networkUrl(
      Uri.parse(resolved),
      videoPlayerOptions: videoPlayerOptions,
      formatHint: _formatHint(resolved),
    );
  }

  /// Initialize with a timeout. On failure with a cached file, drop the
  /// cache entry so the caller can retry over the network.
  static Future<void> initializeSafely(
    VideoPlayerController controller, {
    String? urlForCacheInvalidation,
    Duration timeout = initTimeout,
  }) async {
    try {
      await controller.initialize().timeout(timeout);
      if (controller.value.hasError) {
        throw StateError(controller.value.errorDescription ?? 'decode error');
      }
    } catch (e) {
      if (urlForCacheInvalidation != null && urlForCacheInvalidation.isNotEmpty) {
        VideoPathIndex.remove(urlForCacheInvalidation);
      }
      rethrow;
    }
  }

  static VideoFormat? _formatHint(String url) {
    final lower = url.toLowerCase();
    if (lower.contains('.m3u8')) return VideoFormat.hls;
    if (lower.contains('.mpd')) return VideoFormat.dash;
    // Let fvp / ExoPlayer / AVPlayer probe progressive MP4 themselves.
    return null;
  }
}

/// Synchronous URL → local file map so playback never waits on async cache I/O
/// for the first frame when the file is already on disk.
class VideoPathIndex {
  VideoPathIndex._();

  static final Map<String, String> _paths = {};

  static String _key(String url) => VideoPlayback.mediaCacheKey(url);

  static void put(String url, String path) {
    final key = _key(url);
    if (key.isEmpty || path.isEmpty) return;
    _paths[key] = path;
  }

  static void putFile(String url, File file) => put(url, file.path);

  static void remove(String url) {
    _paths.remove(_key(url));
  }

  static void clear() => _paths.clear();

  static String? pathFor(String url) {
    final key = _key(url);
    final path = _paths[key];
    if (path == null) return null;
    try {
      if (File(path).existsSync()) return path;
    } catch (_) {}
    _paths.remove(key);
    return null;
  }

  static File? fileFor(String url) {
    final path = pathFor(url);
    return path == null ? null : File(path);
  }

  static bool has(String url) => pathFor(url) != null;

  /// Best-effort hydrate from a cache manager file info.
  static void remember(String url, File file) {
    try {
      if (file.existsSync()) putFile(url, file);
    } catch (e, st) {
      if (kDebugMode) {
        debugPrint('VideoPathIndex.remember failed: $e\n$st');
      }
    }
  }
}
