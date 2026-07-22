import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/image_cache_manager.dart';

/// Resolves a teacher/user profile photo from flat or nested API payloads.
String? resolveProfilePhotoUrl(Map<String, dynamic>? source) {
  if (source == null) return null;

  String? pick(dynamic v) {
    final s = v?.toString().trim();
    return (s == null || s.isEmpty) ? null : s;
  }

  final direct = pick(source['profilePhotoUrl']);
  if (direct != null) return direct;

  final nested = source['user'];
  if (nested is Map) {
    final nestedUrl = pick(nested['profilePhotoUrl']);
    if (nestedUrl != null) return nestedUrl;
  }

  final key = pick(source['profilePhotoKey']) ??
      (nested is Map ? pick(nested['profilePhotoKey']) : null);
  if (key == null) return null;
  final encoded = key
      .split('/')
      .where((p) => p.isNotEmpty)
      .map(Uri.encodeComponent)
      .join('/');
  return '/api/media/$encoded';
}

/// Circular avatar with optional photo, initials fallback, and edit affordance.
class ProfileAvatar extends StatelessWidget {
  const ProfileAvatar({
    super.key,
    required this.name,
    this.photoUrl,
    this.size = 96,
    this.editable = false,
    this.uploading = false,
    this.onTap,
    /// Busts cache after a photo replace (e.g. user id + timestamp).
    this.cacheVersion,
  });

  final String? name;
  final String? photoUrl;
  final double size;
  final bool editable;
  final bool uploading;
  final VoidCallback? onTap;
  final String? cacheVersion;

  String get _initials {
    final n = (name ?? '?').trim();
    return n
        .split(RegExp(r'\s+'))
        .take(2)
        .map((w) => w.isEmpty ? '' : w[0].toUpperCase())
        .join();
  }

  String? get _resolvedUrl {
    final url = photoUrl?.trim();
    if (url == null || url.isEmpty) return null;
    final absolute = ApiClient.absoluteUrl(url);
    if (!absolute.startsWith('http')) return null;
    return absolute;
  }

  Widget _initialsDisk() {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: AppTheme.gradient,
      ),
      child: Text(
        _initials.isEmpty ? '?' : _initials,
        style: TextStyle(
          fontSize: size * 0.32,
          fontWeight: FontWeight.bold,
          color: Colors.white,
        ),
      ),
    );
  }

  Widget _photo(String url) {
    final dpr = WidgetsBinding.instance.platformDispatcher.views.isNotEmpty
        ? WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio
        : 2.0;
    final mem = (size * dpr).round().clamp(64, 512);
    final key = cacheVersion != null && cacheVersion!.isNotEmpty
        ? '$url|$cacheVersion'
        : url;

    return CachedNetworkImage(
      imageUrl: url,
      cacheManager: UlearnImageCache.manager,
      cacheKey: key,
      width: size,
      height: size,
      fit: BoxFit.cover,
      memCacheWidth: mem,
      fadeInDuration: const Duration(milliseconds: 160),
      fadeOutDuration: const Duration(milliseconds: 80),
      placeholder: (_, _) => _initialsDisk(),
      errorWidget: (_, _, _) => _initialsDisk(),
      imageBuilder: (context, provider) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          image: DecorationImage(image: provider, fit: BoxFit.cover),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final resolved = _resolvedUrl;

    Widget avatar = ClipOval(
      child: resolved != null ? _photo(resolved) : _initialsDisk(),
    );

    avatar = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: editable ? AppTheme.accent.withValues(alpha: 0.6) : Colors.white24,
          width: editable ? 2.5 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.primary.withValues(alpha: 0.25),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: avatar,
    );

    if (uploading) {
      avatar = Stack(
        alignment: Alignment.center,
        children: [
          avatar,
          Container(
            width: size,
            height: size,
            decoration: const BoxDecoration(
              color: Colors.black54,
              shape: BoxShape.circle,
            ),
            child: const Center(
              child: SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(strokeWidth: 2.5, color: AppTheme.accent),
              ),
            ),
          ),
        ],
      );
    } else if (editable) {
      avatar = Stack(
        clipBehavior: Clip.none,
        children: [
          avatar,
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppTheme.primary,
                shape: BoxShape.circle,
                border: Border.all(color: AppTheme.background, width: 2),
              ),
              child: Icon(
                resolved != null ? Icons.edit_outlined : Icons.camera_alt_outlined,
                size: size * 0.16,
                color: Colors.white,
              ),
            ),
          ),
        ],
      );
    }

    if (onTap != null) {
      return Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: uploading ? null : onTap,
          customBorder: const CircleBorder(),
          child: avatar,
        ),
      );
    }

    return avatar;
  }
}
