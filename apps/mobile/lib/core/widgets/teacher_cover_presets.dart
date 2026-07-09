import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Twelve curated gradient banners for teacher profile covers.
class TeacherCoverPresets {
  TeacherCoverPresets._();

  static const count = 12;

  static List<Color> colorsFor(int? preset) {
    final i = (preset ?? 0).clamp(0, count - 1);
    return _presets[i];
  }

  static const _presets = <List<Color>>[
    [Color(0xFF6B21FF), Color(0xFFA020F0), Color(0xFF00E5FF)],
    [Color(0xFF0F2027), Color(0xFF203A43), Color(0xFF2C5364)],
    [Color(0xFF141E30), Color(0xFF243B55), Color(0xFF4A6FA5)],
    [Color(0xFF200122), Color(0xFF6F0000), Color(0xFFFF512F)],
    [Color(0xFF000428), Color(0xFF004e92), Color(0xFF00C9FF)],
    [Color(0xFF134E5E), Color(0xFF71B280), Color(0xFFB8E986)],
    [Color(0xFF3A1C71), Color(0xFFD76D77), Color(0xFFFFAF7B)],
    [Color(0xFF0F0C29), Color(0xFF302B63), Color(0xFF24243E)],
    [Color(0xFF1A2980), Color(0xFF26D0CE), Color(0xFF00E5FF)],
    [Color(0xFF42275A), Color(0xFF734B6D), Color(0xFFB06AB3)],
    [Color(0xFF232526), Color(0xFF414345), Color(0xFF7B8794)],
    [Color(0xFF11998E), Color(0xFF38EF7D), Color(0xFF00E5FF)],
  ];
}

/// Renders a teacher profile banner from a preset id.
class TeacherCoverBanner extends StatelessWidget {
  const TeacherCoverBanner({
    super.key,
    required this.preset,
    this.height,
    this.borderRadius,
    this.child,
  });

  final int? preset;
  final double? height;
  final BorderRadius? borderRadius;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final colors = TeacherCoverPresets.colorsFor(preset);
    final seed = (preset ?? 0).clamp(0, TeacherCoverPresets.count - 1);

    Widget banner = CustomPaint(
      painter: _BannerPainter(colors: colors, seed: seed),
      child: child,
    );

    if (height != null) {
      banner = SizedBox(height: height, width: double.infinity, child: banner);
    }

    if (borderRadius != null) {
      banner = ClipRRect(borderRadius: borderRadius!, child: banner);
    }

    return banner;
  }
}

class _BannerPainter extends CustomPainter {
  _BannerPainter({required this.colors, required this.seed});

  final List<Color> colors;
  final int seed;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = ui.Gradient.linear(
          Offset(size.width * 0.1, 0),
          Offset(size.width * 0.9, size.height),
          colors,
        ),
    );

    final glow = Paint()..color = Colors.white.withValues(alpha: 0.06);
    for (var i = 0; i < 6; i++) {
      final r = 40.0 + i * 28 + (seed * 7);
      canvas.drawCircle(
        Offset(size.width * (0.15 + seed * 0.05), size.height * 0.35),
        r,
        glow,
      );
    }

    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..color = Colors.white.withValues(alpha: 0.12);
    for (var i = 0; i < 4; i++) {
      canvas.drawCircle(
        Offset(size.width * 0.82, size.height * 0.25),
        24.0 + i * 18 + seed * 2,
        ring,
      );
    }

    final sparkle = Paint()..color = AppTheme.accent.withValues(alpha: 0.35);
    final rnd = math.Random(seed + 42);
    for (var i = 0; i < 14; i++) {
      final x = rnd.nextDouble() * size.width;
      final y = rnd.nextDouble() * size.height;
      canvas.drawCircle(Offset(x, y), 1.2 + rnd.nextDouble() * 2, sparkle);
    }

    canvas.drawRect(
      rect,
      Paint()
        ..shader = ui.Gradient.linear(
          Offset(0, size.height * 0.45),
          Offset(0, size.height),
          [Colors.transparent, Colors.black.withValues(alpha: 0.55)],
        ),
    );
  }

  @override
  bool shouldRepaint(_BannerPainter old) => old.seed != seed;
}

/// Grid for teachers to pick a profile cover preset.
class TeacherCoverPicker extends StatelessWidget {
  const TeacherCoverPicker({
    super.key,
    required this.selected,
    required this.onSelected,
  });

  final int? selected;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 1.6,
      ),
      itemCount: TeacherCoverPresets.count,
      itemBuilder: (context, i) {
        final isSelected = selected == i;
        return GestureDetector(
          onTap: () => onSelected(i),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isSelected ? AppTheme.accent : AppTheme.cardBorder,
                width: isSelected ? 2.5 : 1,
              ),
              boxShadow: isSelected
                  ? [
                      BoxShadow(
                        color: AppTheme.accent.withValues(alpha: 0.35),
                        blurRadius: 12,
                        spreadRadius: 1,
                      ),
                    ]
                  : null,
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(11),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  TeacherCoverBanner(preset: i),
                  if (isSelected)
                    const Align(
                      alignment: Alignment.topRight,
                      child: Padding(
                        padding: EdgeInsets.all(6),
                        child: Icon(Icons.check_circle, color: AppTheme.accent, size: 22),
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
}
