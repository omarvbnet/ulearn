import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Full-bleed backdrop of slowly rising glowing dots over a theme-aware
/// space gradient — used on splash and auth screens in light and dark mode.
class ParticleField extends StatefulWidget {
  const ParticleField({super.key, this.particleCount = 26});

  final int particleCount;

  @override
  State<ParticleField> createState() => _ParticleFieldState();
}

class _ParticleFieldState extends State<ParticleField>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(seconds: 14))
      ..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Stack(
      fit: StackFit.expand,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: const Alignment(0, -0.2),
              radius: 1.3,
              colors: isDark
                  ? const [Color(0xFF12102E), Color(0xFF050510)]
                  : const [Color(0xFFEDE8FF), Color(0xFFF4F6FB)],
            ),
          ),
        ),
        AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => CustomPaint(
            painter: _ParticlesPainter(
              t: _controller.value,
              count: widget.particleCount,
              isDark: isDark,
            ),
          ),
        ),
      ],
    );
  }
}

class _ParticlesPainter extends CustomPainter {
  _ParticlesPainter({
    required this.t,
    required this.count,
    required this.isDark,
  });

  final double t;
  final int count;
  final bool isDark;

  static final _seeds = List.generate(40, (i) {
    final rnd = math.Random(i * 7919);
    return (
      rnd.nextDouble(), // x
      rnd.nextDouble(), // y phase
      1.2 + rnd.nextDouble() * 2.2, // radius
      0.25 + rnd.nextDouble() * 0.5, // speed
      rnd.nextBool(), // cyan or purple
    );
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    final maxOpacity = isDark ? 0.35 : 0.28;
    for (final (x, phase, radius, speed, cyan) in _seeds.take(count)) {
      final y = (phase + t * speed) % 1.0;
      final opacity = (math.sin(y * math.pi)).clamp(0.0, 1.0) * maxOpacity;
      paint.color =
          (cyan ? AppTheme.accent : AppTheme.primary).withValues(alpha: opacity);
      canvas.drawCircle(
        Offset(x * size.width, size.height * (1 - y)),
        radius,
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_ParticlesPainter old) =>
      old.t != t || old.count != count || old.isDark != isDark;
}
