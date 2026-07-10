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

  static const httpHeaders = <String, String>{
    'Connection': 'keep-alive',
    'Accept': '*/*',
  };

  /// Build an optimized controller. Uses disk path when known/cached.
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
      httpHeaders: httpHeaders,
      formatHint: _formatHint(resolved),
    );
  }

  static VideoFormat? _formatHint(String url) {
    final lower = url.toLowerCase();
    if (lower.contains('.m3u8')) return VideoFormat.hls;
    if (lower.contains('.mpd')) return VideoFormat.dash;
    // Progressive MP4 / media gateway — hint helps ExoPlayer/AVPlayer/fvp start faster.
    if (lower.contains('.mp4') ||
        lower.contains('.mov') ||
        lower.contains('.m4v') ||
        lower.contains('/api/media/')) {
      return VideoFormat.other;
    }
    return null;
  }
}

/// Synchronous URL → local file map so playback never waits on async cache I/O
/// for the first frame when the file is already on disk.
class VideoPathIndex {
  VideoPathIndex._();

  static final Map<String, String> _paths = {};

  static void put(String url, String path) {
    final resolved = ApiClient.absoluteUrl(url);
    if (resolved.isEmpty || path.isEmpty) return;
    _paths[resolved] = path;
  }

  static void putFile(String url, File file) => put(url, file.path);

  static void remove(String url) {
    _paths.remove(ApiClient.absoluteUrl(url));
  }

  static void clear() => _paths.clear();

  static String? pathFor(String url) {
    final resolved = ApiClient.absoluteUrl(url);
    final path = _paths[resolved];
    if (path == null) return null;
    try {
      if (File(path).existsSync()) return path;
    } catch (_) {}
    _paths.remove(resolved);
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
