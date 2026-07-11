import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Shared glass used by reels action circles + bottom navigation.
class GlassSurface extends StatelessWidget {
  const GlassSurface({
    super.key,
    required this.child,
    this.borderRadius,
    this.padding,
    this.sigma = 24,
    this.circle = false,
  });

  final Widget child;
  final BorderRadius? borderRadius;
  final EdgeInsetsGeometry? padding;
  final double sigma;
  final bool circle;

  /// Same recipe as reels like / save / views circles.
  static Color fill() {
    if (AppTheme.isDark) {
      return Colors.black.withValues(alpha: 0.38);
    }
    return Colors.white.withValues(alpha: 0.55);
  }

  static Color rim() {
    if (AppTheme.isDark) {
      return Colors.white.withValues(alpha: 0.10);
    }
    return Colors.black.withValues(alpha: 0.08);
  }

  /// Always the reels-on-video look (dark frosted circle).
  static Color reelCircleFill() => Colors.black.withValues(alpha: 0.38);

  static Color reelCircleRim() => Colors.white.withValues(alpha: 0.10);

  @override
  Widget build(BuildContext context) {
    final radius = circle
        ? null
        : (borderRadius ?? BorderRadius.circular(999));
    return ClipRRect(
      borderRadius: circle ? BorderRadius.circular(999) : (radius ?? BorderRadius.zero),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            shape: circle ? BoxShape.circle : BoxShape.rectangle,
            borderRadius: circle ? null : radius,
            color: fill(),
            border: Border.all(color: rim(), width: 1),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// Frosted glass circle — same UX as reels like / save / views.
class GlassCircle extends StatelessWidget {
  const GlassCircle({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(10),
    this.sigma = 20,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double sigma;

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: GlassSurface.reelCircleFill(),
            border: Border.all(color: GlassSurface.reelCircleRim()),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// App bar matched to the scaffold background (same color as the app).
class GlassAppBar extends StatelessWidget implements PreferredSizeWidget {
  const GlassAppBar({
    super.key,
    this.title,
    this.leading,
    this.actions,
    this.bottom,
    this.automaticallyImplyLeading = true,
    this.centerTitle,
    this.titleSpacing,
    this.toolbarHeight,
    this.leadingWidth,
  });

  final Widget? title;
  final Widget? leading;
  final List<Widget>? actions;
  final PreferredSizeWidget? bottom;
  final bool automaticallyImplyLeading;
  final bool? centerTitle;
  final double? titleSpacing;
  final double? toolbarHeight;
  final double? leadingWidth;

  @override
  Size get preferredSize {
    final height = toolbarHeight ?? kToolbarHeight;
    final bottomHeight = bottom?.preferredSize.height ?? 0;
    return Size.fromHeight(height + bottomHeight);
  }

  @override
  Widget build(BuildContext context) {
    return AppBar(
      title: title,
      leading: leading,
      actions: actions,
      bottom: bottom,
      automaticallyImplyLeading: automaticallyImplyLeading,
      centerTitle: centerTitle,
      titleSpacing: titleSpacing,
      toolbarHeight: toolbarHeight,
      leadingWidth: leadingWidth,
      backgroundColor: AppTheme.background,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      forceMaterialTransparency: false,
      flexibleSpace: ColoredBox(color: AppTheme.background),
    );
  }
}
