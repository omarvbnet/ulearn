import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// The U Learn logo drawn fully in code (no image asset): a circuit-board
/// letter "U" with staggered traces, connection nodes, branch elbows and
/// dissolving pixels, painted with the brand purple → cyan gradient.
///
/// [progress] (0..1) animates the traces drawing themselves in;
/// [glow] adds a soft neon glow behind the strokes.
class ULearnLogo extends StatelessWidget {
  const ULearnLogo({
    super.key,
    this.size = 120,
    this.progress = 1.0,
    this.glow = 0.6,
  });

  final double size;
  final double progress;
  final double glow;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: ULearnLogoPainter(progress: progress, glow: glow),
      ),
    );
  }
}

/// Logo mark + "U Learn" wordmark in a row (used in app bars).
class ULearnLogoRow extends StatelessWidget {
  const ULearnLogoRow({super.key, this.markSize = 28, this.fontSize = 18});

  final double markSize;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ULearnLogo(size: markSize),
        const SizedBox(width: 8),
        ShaderMask(
          shaderCallback: (bounds) => AppTheme.gradient.createShader(bounds),
          child: Text(
            'U Learn',
            style: TextStyle(
              fontSize: fontSize,
              fontWeight: FontWeight.w700,
              color: Colors.white,
              letterSpacing: 0.5,
            ),
          ),
        ),
      ],
    );
  }
}

class ULearnLogoPainter extends CustomPainter {
  ULearnLogoPainter({required this.progress, required this.glow});

  final double progress;
  final double glow;

  // Geometry is designed on a 200x200 canvas and scaled to fit.
  static const _design = 200.0;

  /// U traces: (left x, right x, bottom radius, left top y, right top y).
  static const _traces = [
    (52.0, 148.0, 48.0, 40.0, 28.0),
    (64.0, 136.0, 36.0, 26.0, 44.0),
    (76.0, 124.0, 24.0, 46.0, 32.0),
    (88.0, 112.0, 12.0, 30.0, 52.0),
  ];

  /// Branch elbows: (start x, start y, dx1, dy2) — horizontal then vertical.
  static const _branches = [
    (52.0, 78.0, -14.0, -16.0),
    (148.0, 70.0, 14.0, -18.0),
    (136.0, 96.0, 16.0, 14.0),
    (64.0, 104.0, -16.0, 12.0),
  ];

  /// Dissolving pixels, top-left diagonal: (x, y, size, opacity).
  static const _pixels = [
    (18.0, 14.0, 7.0, 0.55),
    (34.0, 22.0, 5.0, 0.75),
    (24.0, 34.0, 9.0, 0.65),
    (44.0, 10.0, 4.0, 0.5),
    (48.0, 30.0, 6.0, 0.9),
    (12.0, 48.0, 5.0, 0.45),
    (36.0, 44.0, 8.0, 0.85),
    (56.0, 18.0, 5.0, 0.7),
    (28.0, 58.0, 6.0, 0.6),
    (46.0, 56.0, 4.0, 0.8),
  ];

  static const _bottomY = 118.0;

  Shader _gradient(Rect rect) => const LinearGradient(
        colors: [Color(0xFFB44CF0), Color(0xFFA020F0), Color(0xFF3D8BFF), Color(0xFF00E5FF)],
        stops: [0.0, 0.25, 0.6, 1.0],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ).createShader(rect);

  Path _tracePath(double xL, double xR, double radius, double tL, double tR) {
    final cx = (_design / 2);
    final path = Path()
      ..moveTo(xL, tL)
      ..lineTo(xL, _bottomY)
      ..arcTo(
        Rect.fromCircle(center: Offset(cx, _bottomY), radius: radius),
        math.pi,
        -math.pi,
        false,
      )
      ..lineTo(xR, tR);
    return path;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / _design;
    canvas.scale(scale);
    final rect = Rect.fromLTWH(0, 0, _design, _design);
    final t = Curves.easeInOutCubic.transform(progress.clamp(0.0, 1.0));

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..shader = _gradient(rect);

    final glowPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 9
      ..strokeCap = StrokeCap.round
      ..shader = _gradient(rect)
      ..color = Colors.white.withValues(alpha: (0.35 * glow).clamp(0.0, 1.0))
      ..maskFilter = ui.MaskFilter.blur(ui.BlurStyle.normal, 6 + 6 * glow);

    // Traces draw in sequence, each slightly delayed after the previous.
    for (var i = 0; i < _traces.length; i++) {
      final (xL, xR, radius, tL, tR) = _traces[i];
      final path = _tracePath(xL, xR, radius, tL, tR);
      final metric = path.computeMetrics().first;

      final delay = i * 0.12;
      final local = ((t - delay) / (1 - delay)).clamp(0.0, 1.0);
      if (local <= 0) continue;
      final partial = metric.extractPath(0, metric.length * local);

      if (glow > 0) canvas.drawPath(partial, glowPaint);
      canvas.drawPath(partial, stroke);

      // Connection nodes pop in at the trace tips once drawn.
      if (local >= 0.98) {
        _drawNode(canvas, Offset(xL, tL), rect, t);
        _drawNode(canvas, Offset(xR, tR), rect, t);
      }
    }

    // Branch elbows + end dots appear near the end of the draw-in.
    final branchT = ((t - 0.55) / 0.45).clamp(0.0, 1.0);
    if (branchT > 0) {
      final branchStroke = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.4
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..shader = _gradient(rect);
      for (final (sx, sy, dx, dy) in _branches) {
        final path = Path()
          ..moveTo(sx, sy)
          ..relativeLineTo(dx, 0)
          ..relativeLineTo(0, dy);
        final metric = path.computeMetrics().first;
        final partial = metric.extractPath(0, metric.length * branchT);
        canvas.drawPath(partial, branchStroke);
        if (branchT >= 0.98) {
          _drawNode(canvas, Offset(sx + dx, sy + dy), rect, t, small: true);
        }
      }
    }

    // Dissolving pixels fade in with a stagger.
    final pixelPaint = Paint();
    for (var i = 0; i < _pixels.length; i++) {
      final (x, y, s, o) = _pixels[i];
      final delay = 0.3 + (i % 5) * 0.1;
      final local = ((t - delay) / (1 - delay)).clamp(0.0, 1.0);
      if (local <= 0) continue;
      pixelPaint
        ..shader = null
        ..color = Color.lerp(
          const Color(0xFFB44CF0),
          const Color(0xFF7B2FF0),
          (i % 3) / 2,
        )!
            .withValues(alpha: o * local);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromCenter(center: Offset(x, y), width: s, height: s),
          const Radius.circular(1.2),
        ),
        pixelPaint,
      );
    }
  }

  void _drawNode(Canvas canvas, Offset center, Rect rect, double t, {bool small = false}) {
    final r = small ? 3.2 : 4.4;
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = small ? 2.4 : 3
      ..shader = _gradient(rect);
    final fill = Paint()..color = const Color(0xFF050510);
    canvas.drawCircle(center, r, fill);
    canvas.drawCircle(center, r, ring);
  }

  @override
  bool shouldRepaint(ULearnLogoPainter old) =>
      old.progress != progress || old.glow != glow;
}

/// Logo with a built-in idle glow pulse (for static placements that
/// should still feel alive).
class PulsingULearnLogo extends StatefulWidget {
  const PulsingULearnLogo({super.key, this.size = 120});

  final double size;

  @override
  State<PulsingULearnLogo> createState() => _PulsingULearnLogoState();
}

class _PulsingULearnLogoState extends State<PulsingULearnLogo>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => ULearnLogo(
        size: widget.size,
        glow: 0.35 + 0.55 * _controller.value,
      ),
    );
  }
}
