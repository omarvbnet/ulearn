import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Full-bleed backdrop of slowly rising glowing dots over a deep
/// space gradient — the brand ambience used on splash and auth screens.
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
    return Stack(
      fit: StackFit.expand,
      children: [
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0, -0.2),
              radius: 1.3,
              colors: [Color(0xFF12102E), Color(0xFF050510)],
            ),
          ),
        ),
        AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => CustomPaint(
            painter: _ParticlesPainter(t: _controller.value, count: widget.particleCount),
          ),
        ),
      ],
    );
  }
}

class _ParticlesPainter extends CustomPainter {
  _ParticlesPainter({required this.t, required this.count});

  final double t;
  final int count;

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
    for (final (x, phase, radius, speed, cyan) in _seeds.take(count)) {
      final y = (phase + t * speed) % 1.0;
      final opacity = (math.sin(y * math.pi)).clamp(0.0, 1.0) * 0.35;
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
  bool shouldRepaint(_ParticlesPainter old) => old.t != t || old.count != count;
}
