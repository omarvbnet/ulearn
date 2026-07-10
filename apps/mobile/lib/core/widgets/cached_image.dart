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
  });

  final String url;
  final BoxFit fit;
  final double? width;
  final double? height;
  final BorderRadius? borderRadius;
  final Widget? placeholder;
  final Widget? error;

  String get _resolved => ApiClient.absoluteUrl(url);

  @override
  Widget build(BuildContext context) {
    Widget image = CachedNetworkImage(
      imageUrl: _resolved,
      fit: fit,
      width: width,
      height: height,
      fadeInDuration: const Duration(milliseconds: 220),
      fadeOutDuration: const Duration(milliseconds: 120),
      placeholder: (context, url) =>
          placeholder ??
          Container(
            color: AppTheme.card,
            alignment: Alignment.center,
            child: const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent),
            ),
          ),
      errorWidget: (_, _, _) =>
          error ??
          Container(
            color: AppTheme.card,
            alignment: Alignment.center,
            child: Icon(Icons.image_not_supported_outlined, color: AppTheme.muted.withValues(alpha: 0.6)),
          ),
    );

    if (borderRadius != null) {
      image = ClipRRect(borderRadius: borderRadius!, child: image);
    }

    return image;
  }
}

/// Cached circle avatar image provider helper.
ImageProvider cachedImageProvider(String url) =>
    CachedNetworkImageProvider(ApiClient.absoluteUrl(url));

/// Evict a URL from disk + memory image caches (e.g. after cover replace).
Future<void> evictCachedImage(String? url) async {
  if (url == null || url.isEmpty) return;
  final resolved = ApiClient.absoluteUrl(url);
  await CachedNetworkImage.evictFromCache(resolved);
  imageCache.evict(CachedNetworkImageProvider(resolved));
  imageCache.evict(NetworkImage(resolved));
}