import 'package:flutter/material.dart';

/// Fade + slide-up entrance, staggered by [index].
class StaggeredItem extends StatelessWidget {
  const StaggeredItem({super.key, required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 350 + (index.clamp(0, 10) * 60)),
      curve: Curves.easeOutCubic,
      builder: (context, value, child) => Opacity(
        opacity: value,
        child: Transform.translate(
          offset: Offset(0, 24 * (1 - value)),
          child: child,
        ),
      ),
      child: child,
    );
  }
}

/// Scale-in entrance for hero elements (result rings, podium, etc).
class ScaleIn extends StatelessWidget {
  const ScaleIn({super.key, required this.child, this.delayMs = 0});

  final Widget child;
  final int delayMs;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 450 + delayMs),
      curve: Curves.elasticOut,
      builder: (context, value, child) =>
          Transform.scale(scale: value.clamp(0.0, 1.2), child: child),
      child: child,
    );
  }
}
