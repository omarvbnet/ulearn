import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Disk + memory cached network image for faster scroll and repeat visits.
class CachedImage extends StatelessWidget {
  const CachedImage({
    super.key,
    required this.url,
    this.fit = BoxFit.cover,
    this.width,
    this.height,
    this.borderRadius,
    this.placeholder,
    this.error,
    /// Busts disk/memory cache when the same path is reused (e.g. course.updatedAt).
    this.cacheVersion,
  });

  final String url;
  final BoxFit fit;
  final double? width;
  final double? height;
  final BorderRadius? borderRadius;
  final Widget? placeholder;
  final Widget? error;
  final String? cacheVersion;

  String get _resolved => ApiClient.absoluteUrl(url);

  bool get _usable {
    final u = url.trim();
    return u.isNotEmpty && _resolved.startsWith('http');
  }

  Widget get _fallback =>
      error ??
      Container(
        color: AppTheme.card,
        alignment: Alignment.center,
        child: Icon(Icons.image_not_supported_outlined, color: AppTheme.muted.withValues(alpha: 0.6)),
      );

  Widget get _loading =>
      placeholder ??
      Container(
        color: AppTheme.card,
        alignment: Alignment.center,
        child: const SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent),
        ),
      );

  @override
  Widget build(BuildContext context) {
    if (!_usable) {
      Widget broken = _fallback;
      if (borderRadius != null) {
        broken = ClipRRect(borderRadius: borderRadius!, child: broken);
      }
      return SizedBox(width: width, height: height, child: broken);
    }

    final dpr = MediaQuery.devicePixelRatioOf(context);
    final memW = width != null && width!.isFinite ? (width! * dpr).round() : 900;

    Widget image = CachedNetworkImage(
      imageUrl: _resolved,
      cacheKey: cacheVersion != null && cacheVersion!.isNotEmpty
          ? '$_resolved|$cacheVersion'
          : _resolved,
      fit: fit,
      width: width,
      height: height,
      memCacheWidth: memW.clamp(64, 1600),
      fadeInDuration: const Duration(milliseconds: 180),
      fadeOutDuration: const Duration(milliseconds: 100),
      placeholder: (context, url) => _loading,
      errorWidget: (_, _, _) => _fallback,
    );

    if (borderRadius != null) {
      image = ClipRRect(borderRadius: borderRadius!, child: image);
    }

    return image;
  }
}

/// Cached circle avatar image provider helper.
ImageProvider cachedImageProvider(String url, {String? cacheVersion}) {
  final resolved = ApiClient.absoluteUrl(url);
  return CachedNetworkImageProvider(
    resolved,
    cacheKey: cacheVersion != null && cacheVersion.isNotEmpty
        ? '$resolved|$cacheVersion'
        : resolved,
  );
}

/// Evict a URL from disk + memory image caches (e.g. after cover replace).
Future<void> evictCachedImage(String? url, {String? cacheVersion}) async {
  if (url == null || url.trim().isEmpty) return;
  final resolved = ApiClient.absoluteUrl(url);
  final key = cacheVersion != null && cacheVersion.isNotEmpty
      ? '$resolved|$cacheVersion'
      : resolved;
  await CachedNetworkImage.evictFromCache(resolved);
  await CachedNetworkImage.evictFromCache(key);
  imageCache.evict(CachedNetworkImageProvider(resolved));
  imageCache.evict(NetworkImage(resolved));
}
