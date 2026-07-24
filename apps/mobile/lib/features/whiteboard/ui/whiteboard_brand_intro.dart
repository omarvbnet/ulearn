import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/particle_field.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';

/// Full-bleed animated U Learn vector-logo intro shown before a board lesson.
///
/// Timeline (~5s): draw traces → wordmark rises → soft hold → fade out.
/// Tap anywhere to skip.
class WhiteboardBrandIntro extends StatefulWidget {
  const WhiteboardBrandIntro({
    super.key,
    this.onFinished,
    this.lessonTitle,
    this.duration = const Duration(milliseconds: 5000),
  });

  final VoidCallback? onFinished;
  final String? lessonTitle;
  final Duration duration;

  @override
  State<WhiteboardBrandIntro> createState() => _WhiteboardBrandIntroState();
}

class _WhiteboardBrandIntroState extends State<WhiteboardBrandIntro>
    with TickerProviderStateMixin {
  late final AnimationController _draw;
  late final AnimationController _pulse;
  late final AnimationController _exit;
  late final AnimationController _orbit;
  bool _finished = false;

  @override
  void initState() {
    super.initState();
    _draw = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1700),
    )..forward();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat(reverse: true);
    _orbit = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 5200),
    )..repeat();
    _exit = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 720),
    );

    final holdMs = widget.duration.inMilliseconds - 720;
    Future<void>.delayed(Duration(milliseconds: holdMs.clamp(2800, 5000)), () {
      if (!mounted || _finished) return;
      _exit.forward().whenComplete(_complete);
    });
  }

  void _complete() {
    if (_finished) return;
    _finished = true;
    widget.onFinished?.call();
  }

  void _skip() {
    if (_finished) return;
    _exit.forward(from: 0).whenComplete(_complete);
  }

  @override
  void dispose() {
    _draw.dispose();
    _pulse.dispose();
    _exit.dispose();
    _orbit.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.lessonTitle?.trim();
    return AnimatedBuilder(
      animation: Listenable.merge([_draw, _pulse, _exit, _orbit]),
      builder: (context, _) {
        final fadeOut = 1.0 - Curves.easeInCubic.transform(_exit.value);
        final drawT = Curves.easeInOutCubic.transform(_draw.value);
        final wordT = Curves.easeOutCubic
            .transform(((_draw.value - 0.48) / 0.52).clamp(0.0, 1.0));
        final glow = (_draw.isCompleted ? 0.45 + 0.5 * _pulse.value : 0.55);

        return Opacity(
          opacity: fadeOut,
          child: Material(
            color: Colors.transparent,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: _skip,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  const ColoredBox(color: Color(0xFF050510)),
                  const ParticleField(particleCount: 34),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: RadialGradient(
                        center: Alignment(
                          -0.15 + 0.1 * _pulse.value,
                          -0.2,
                        ),
                        radius: 0.85 + 0.08 * _pulse.value,
                        colors: [
                          const Color(0xFFB44CF0).withValues(alpha: 0.28 * fadeOut),
                          const Color(0xFF3D8BFF).withValues(alpha: 0.12 * fadeOut),
                          Colors.transparent,
                        ],
                        stops: const [0.0, 0.45, 1.0],
                      ),
                    ),
                  ),
                  CustomPaint(
                    painter: _IntroOrbitPainter(
                      progress: _orbit.value,
                      intensity: drawT * fadeOut,
                    ),
                  ),
                  Center(
                    child: Transform.scale(
                      scale: 0.92 + 0.08 * drawT,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          ULearnLogo(
                            size: 148,
                            progress: drawT,
                            glow: glow,
                          ),
                          const SizedBox(height: 22),
                          Opacity(
                            opacity: wordT,
                            child: Transform.translate(
                              offset: Offset(0, 16 * (1 - wordT)),
                              child: Column(
                                children: [
                                  ShaderMask(
                                    shaderCallback: (bounds) =>
                                        AppTheme.gradient.createShader(bounds),
                                    child: const Text(
                                      'U Learn',
                                      style: TextStyle(
                                        fontSize: 34,
                                        fontWeight: FontWeight.w800,
                                        color: Colors.white,
                                        letterSpacing: 1.4,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    title != null && title.isNotEmpty
                                        ? title
                                        : 'Whiteboard lesson',
                                    textAlign: TextAlign.center,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      color: Colors.white.withValues(alpha: 0.72),
                                      fontSize: 13,
                                      letterSpacing: 1.6,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 28,
                    child: Opacity(
                      opacity: wordT * (1 - _exit.value),
                      child: Column(
                        children: [
                          _IntroProgressBar(value: _timelineProgress()),
                          const SizedBox(height: 10),
                          Text(
                            'Tap to skip',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.45),
                              fontSize: 11,
                              letterSpacing: 1.2,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  double _timelineProgress() {
    final total = widget.duration.inMilliseconds.toDouble();
    final drawn = _draw.value * 1700;
    final exitPart = _exit.value * 720;
    final mid = math.max(0.0, total - 1700 - 720) * (_draw.isCompleted ? 1.0 : 0.0);
    return ((drawn + mid * _pulse.value.clamp(0.3, 1.0) + exitPart) / total)
        .clamp(0.0, 1.0);
  }
}

class _IntroProgressBar extends StatelessWidget {
  const _IntroProgressBar({required this.value});
  final double value;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SizedBox(
        width: 132,
        height: 3,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: Stack(
            fit: StackFit.expand,
            children: [
              ColoredBox(color: Colors.white.withValues(alpha: 0.12)),
              FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: value.clamp(0.05, 1.0),
                child: const DecoratedBox(
                  decoration: BoxDecoration(gradient: AppTheme.gradient),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _IntroOrbitPainter extends CustomPainter {
  _IntroOrbitPainter({required this.progress, required this.intensity});

  final double progress;
  final double intensity;

  @override
  void paint(Canvas canvas, Size size) {
    if (intensity <= 0.01) return;
    final c = Offset(size.width / 2, size.height / 2 - 18);
    final r1 = size.shortestSide * 0.28;
    final r2 = size.shortestSide * 0.36;

    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = const Color(0xFF00E5FF).withValues(alpha: 0.18 * intensity);
    canvas.drawCircle(c, r1, ring);
    canvas.drawCircle(
      c,
      r2,
      ring..color = const Color(0xFFB44CF0).withValues(alpha: 0.12 * intensity),
    );

    final spark = Paint()..style = PaintingStyle.fill;
    for (var i = 0; i < 8; i++) {
      final angle = progress * math.pi * 2 + i * (math.pi / 4);
      final r = i.isEven ? r1 : r2;
      final x = c.dx + r * math.cos(angle);
      final y = c.dy + r * math.sin(angle) * 0.58;
      spark.color = Color.lerp(
        const Color(0xFFB44CF0),
        const Color(0xFF00E5FF),
        i / 7,
      )!
          .withValues(alpha: 0.55 * intensity);
      canvas.drawCircle(Offset(x, y), i.isEven ? 2.8 : 2.0, spark);
    }
  }

  @override
  bool shouldRepaint(covariant _IntroOrbitPainter oldDelegate) =>
      oldDelegate.progress != progress || oldDelegate.intensity != intensity;
}
