import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:video_player/video_player.dart';

/// Shared, high-performance [VideoPlayerController] factory.
///
/// Backed by **fvp** (libmdk) hardware decode on iOS/Android when registered
/// in `main()`. Prefers local files from [VideoPathIndex] for instant start.
///
/// R2/S3 SigV4 URLs are signed for **GET only** — `HEAD` returns 403 while
/// `GET` / `Range` returns 206. Never probe with HEAD; fvp/FFmpeg uses GET
/// Range, and [downloadToCache] uses plain GET as a last-resort fallback.
class VideoPlayback {
  VideoPlayback._();

  static final videoPlayerOptions = VideoPlayerOptions(
    mixWithOthers: true,
    allowBackgroundPlayback: false,
  );

  /// Soft cap for the GET→file fallback. Keep small so TestFlight never sits
  /// on "loading" while pulling a 50MB+ lesson through a slow path.
  static const maxDownloadFallbackBytes = 12 * 1024 * 1024;

  /// How long [initialize] may take before we abort and retry.
  static const initTimeout = Duration(seconds: 15);

  /// Stable disk-cache key. R2/S3 signed URLs change query params every
  /// request — stripping them lets the same object reuse a cached file.
  /// Never use this string as a playback URL (signature would be missing).
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

  static bool isSignedObjectUrl(String url) {
    final resolved = ApiClient.absoluteUrl(url);
    final uri = Uri.tryParse(resolved);
    if (uri == null) return false;
    final q = uri.queryParameters;
    return q.containsKey('X-Amz-Signature') ||
        q.containsKey('X-Amz-Algorithm') ||
        q.containsKey('x-amz-signature') ||
        q.containsKey('Signature') ||
        q.containsKey('X-Amz-Credential');
  }

  /// Build an optimized controller. Uses disk path when known/cached.
  ///
  /// Avoid custom HTTP headers on signed R2 URLs — SigV4 URLs only sign
  /// `host`, and extra headers have caused players to hang on buffering.
  ///
  /// Pass the **exact** absolute URL string into [Uri.parse] so encoding of
  /// `X-Amz-*` query values is preserved (rebuilding via `queryParameters`
  /// can percent-encode `/` and invalidate the signature).
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

  /// Open [url] for playback with HEAD-safe recovery:
  /// 1) cached file → 2) network (fvp GET/Range) → 3) optional [refreshUrl]
  /// → 4) plain GET download to disk (never HEAD) when size is small enough.
  static Future<VideoPlayerController> open(
    String url, {
    Future<String?> Function()? refreshUrl,
    bool allowDownloadFallback = true,
    int maxDownloadBytes = maxDownloadFallbackBytes,
  }) async {
    var playUrl = ApiClient.absoluteUrl(url);

    Future<VideoPlayerController> tryNetwork(String u) async {
      // Force network — do not re-pick a bad cached file via VideoPathIndex.
      final c = VideoPlayerController.networkUrl(
        Uri.parse(ApiClient.absoluteUrl(u)),
        videoPlayerOptions: videoPlayerOptions,
        formatHint: _formatHint(ApiClient.absoluteUrl(u)),
      );
      try {
        await initializeSafely(c, urlForCacheInvalidation: u);
        return c;
      } catch (_) {
        try {
          await c.dispose();
        } catch (_) {}
        rethrow;
      }
    }

    // Prefer an already-cached file (from a prior GET download / prefetch).
    final indexed = VideoPathIndex.fileFor(playUrl);
    if (indexed != null) {
      try {
        final c = create(playUrl, file: indexed);
        await initializeSafely(c, urlForCacheInvalidation: playUrl);
        return c;
      } catch (_) {
        VideoPathIndex.remove(playUrl);
      }
    }

    try {
      return await tryNetwork(playUrl);
    } catch (firstError) {
      if (kDebugMode) {
        debugPrint('VideoPlayback.open network failed: $firstError');
      }
    }

    // Fresh signature — expired or briefly invalid X-Amz URLs.
    if (refreshUrl != null) {
      try {
        final fresh = await refreshUrl();
        if (fresh != null && fresh.trim().isNotEmpty) {
          playUrl = ApiClient.absoluteUrl(fresh);
          try {
            return await tryNetwork(playUrl);
          } catch (e) {
            if (kDebugMode) {
              debugPrint('VideoPlayback.open refreshed network failed: $e');
            }
          }
        }
      } catch (e) {
        if (kDebugMode) {
          debugPrint('VideoPlayback.open refreshUrl failed: $e');
        }
      }
    }

    if (!allowDownloadFallback) {
      throw StateError('Video open failed (network)');
    }

    // Last resort: full GET to disk. Works when players probe with HEAD
    // (403 on SigV4) but GET is authorized.
    final file = await downloadToCache(
      playUrl,
      maxBytes: maxDownloadBytes,
    );
    if (file == null) {
      throw StateError('Video open failed (download fallback)');
    }
    final c = create(playUrl, file: file);
    await initializeSafely(c, urlForCacheInvalidation: playUrl);
    return c;
  }

  /// Size probe via `GET Range: bytes=0-0` (never HEAD — R2 signed URLs 403).
  static Future<int?> probeContentLength(String url) async {
    final resolved = ApiClient.absoluteUrl(url);
    try {
      final res = await http
          .get(
            Uri.parse(resolved),
            headers: const {'Range': 'bytes=0-0'},
          )
          .timeout(const Duration(seconds: 8));
      if (res.statusCode == 206 || res.statusCode == 200) {
        final cr = res.headers['content-range'];
        if (cr != null) {
          final slash = cr.lastIndexOf('/');
          if (slash >= 0 && slash < cr.length - 1) {
            final total = int.tryParse(cr.substring(slash + 1).trim());
            if (total != null && total > 0) return total;
          }
        }
        final len = res.contentLength;
        if (len != null && len > 0) return len;
      }
    } catch (_) {}
    return null;
  }

  /// Full-object GET into the app cache dir. Returns null if too large / fails.
  static Future<File?> downloadToCache(
    String url, {
    int maxBytes = maxDownloadFallbackBytes,
  }) async {
    final resolved = ApiClient.absoluteUrl(url);
    final key = mediaCacheKey(resolved);
    try {
      final len = await probeContentLength(resolved);
      if (len != null && len > maxBytes) return null;

      final dir = await getTemporaryDirectory();
      final safeName = key.hashCode.toRadixString(16);
      final out = File('${dir.path}/ulearn_vid_$safeName.mp4');
      if (await out.exists()) {
        final existingLen = await out.length();
        if (existingLen > 0 && (len == null || existingLen == len)) {
          VideoPathIndex.remember(resolved, out);
          return out;
        }
      }

      final client = http.Client();
      try {
        final req = http.Request('GET', Uri.parse(resolved));
        final streamed =
            await client.send(req).timeout(const Duration(seconds: 20));
        if (streamed.statusCode < 200 || streamed.statusCode >= 300) {
          return null;
        }
        final declared = streamed.contentLength;
        if (declared != null && declared > maxBytes) return null;

        final sink = out.openWrite();
        var written = 0;
        await for (final chunk in streamed.stream.timeout(
          const Duration(minutes: 3),
        )) {
          written += chunk.length;
          if (written > maxBytes) {
            await sink.close();
            try {
              await out.delete();
            } catch (_) {}
            return null;
          }
          sink.add(chunk);
        }
        await sink.close();
        if (written <= 0) {
          try {
            await out.delete();
          } catch (_) {}
          return null;
        }
        VideoPathIndex.remember(resolved, out);
        return out;
      } finally {
        client.close();
      }
    } catch (e, st) {
      if (kDebugMode) {
        debugPrint('VideoPlayback.downloadToCache failed: $e\n$st');
      }
      return null;
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
