import 'package:flutter/material.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';

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
  });

  final String? name;
  final String? photoUrl;
  final double size;
  final bool editable;
  final bool uploading;
  final VoidCallback? onTap;

  String get _initials {
    final n = (name ?? '?').trim();
    return n
        .split(RegExp(r'\s+'))
        .take(2)
        .map((w) => w.isEmpty ? '' : w[0].toUpperCase())
        .join();
  }

  String? get _resolvedUrl {
    final url = photoUrl;
    if (url == null || url.isEmpty) return null;
    return ApiClient.absoluteUrl(url);
  }

  @override
  Widget build(BuildContext context) {
    final resolved = _resolvedUrl;

    Widget avatar = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: resolved == null ? AppTheme.gradient : null,
        image: resolved != null
            ? DecorationImage(
                image: NetworkImage(resolved),
                fit: BoxFit.cover,
              )
            : null,
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
      child: resolved == null
          ? Center(
              child: Text(
                _initials.isEmpty ? '?' : _initials,
                style: TextStyle(
                  fontSize: size * 0.32,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            )
          : null,
    );

    if (uploading) {
      avatar = Stack(
        alignment: Alignment.center,
        children: [
          avatar,
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
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
