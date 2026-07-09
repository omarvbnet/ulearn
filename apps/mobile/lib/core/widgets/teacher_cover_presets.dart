import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

enum _CoverPattern { aurora, waves, rings, beams, petals, horizon }

class _CoverStyle {
  const _CoverStyle({
    required this.colors,
    required this.accent,
    required this.pattern,
    this.begin = Alignment.topLeft,
    this.end = Alignment.bottomRight,
  });

  final List<Color> colors;
  final Color accent;
  final _CoverPattern pattern;
  final Alignment begin;
  final Alignment end;
}

/// Twelve bright, distinct profile banners for teachers.
class TeacherCoverPresets {
  TeacherCoverPresets._();

  static const count = 12;

  static _CoverStyle _styleFor(int? preset) {
    final i = (preset ?? 0).clamp(0, count - 1);
    return _styles[i];
  }

  static List<Color> colorsFor(int? preset) => _styleFor(preset).colors;

  static const _styles = <_CoverStyle>[
    _CoverStyle(
      colors: [Color(0xFF7C3AED), Color(0xFF4F46E5), Color(0xFF06B6D4)],
      accent: Color(0xFF67E8F9),
      pattern: _CoverPattern.aurora,
    ),
    _CoverStyle(
      colors: [Color(0xFFF97316), Color(0xFFEC4899), Color(0xFF8B5CF6)],
      accent: Color(0xFFFDE68A),
      pattern: _CoverPattern.petals,
      begin: Alignment.topCenter,
      end: Alignment.bottomLeft,
    ),
    _CoverStyle(
      colors: [Color(0xFF0EA5E9), Color(0xFF2563EB), Color(0xFF7C3AED)],
      accent: Color(0xFFBAE6FD),
      pattern: _CoverPattern.waves,
    ),
    _CoverStyle(
      colors: [Color(0xFF10B981), Color(0xFF059669), Color(0xFF14B8A6)],
      accent: Color(0xFFBBF7D0),
      pattern: _CoverPattern.horizon,
      begin: Alignment.topLeft,
      end: Alignment.bottomCenter,
    ),
    _CoverStyle(
      colors: [Color(0xFF3B82F6), Color(0xFF1D4ED8), Color(0xFF6366F1)],
      accent: Color(0xFFFCD34D),
      pattern: _CoverPattern.rings,
    ),
    _CoverStyle(
      colors: [Color(0xFFE11D48), Color(0xFFDB2777), Color(0xFFA855F7)],
      accent: Color(0xFFFBCFE8),
      pattern: _CoverPattern.beams,
      begin: Alignment.centerLeft,
      end: Alignment.centerRight,
    ),
    _CoverStyle(
      colors: [Color(0xFFF59E0B), Color(0xFFF97316), Color(0xFFEF4444)],
      accent: Color(0xFFFFF7ED),
      pattern: _CoverPattern.aurora,
      begin: Alignment.topRight,
      end: Alignment.bottomLeft,
    ),
    _CoverStyle(
      colors: [Color(0xFF8B5CF6), Color(0xFFC084FC), Color(0xFFF472B6)],
      accent: Color(0xFFEDE9FE),
      pattern: _CoverPattern.petals,
    ),
    _CoverStyle(
      colors: [Color(0xFF06B6D4), Color(0xFF0891B2), Color(0xFF0E7490)],
      accent: Color(0xFFA5F3FC),
      pattern: _CoverPattern.waves,
      begin: Alignment.bottomLeft,
      end: Alignment.topRight,
    ),
    _CoverStyle(
      colors: [Color(0xFF4338CA), Color(0xFF5B21B6), Color(0xFF7C3AED)],
      accent: Color(0xFF00E5FF),
      pattern: _CoverPattern.beams,
    ),
    _CoverStyle(
      colors: [Color(0xFF22C55E), Color(0xFF16A34A), Color(0xFF0D9488)],
      accent: Color(0xFFD9F99D),
      pattern: _CoverPattern.horizon,
    ),
    _CoverStyle(
      colors: [Color(0xFFA020F0), Color(0xFF6B21FF), Color(0xFF00E5FF)],
      accent: Color(0xFFE0F2FE),
      pattern: _CoverPattern.rings,
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
    ),
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
    final style = TeacherCoverPresets._styleFor(preset);
    final seed = (preset ?? 0).clamp(0, TeacherCoverPresets.count - 1);

    Widget banner = CustomPaint(
      painter: _BannerPainter(style: style, seed: seed),
      child: child ?? const SizedBox.expand(),
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
  _BannerPainter({required this.style, required this.seed});

  final _CoverStyle style;
  final int seed;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 0 || size.height <= 0) return;

    final rect = Offset.zero & size;
    final begin = style.begin;
    final end = style.end;

    canvas.drawRect(
      rect,
      Paint()
        ..shader = ui.Gradient.linear(
          _alignOffset(begin, size),
          _alignOffset(end, size),
          style.colors,
          [0.0, 0.55, 1.0],
        ),
    );

    _drawPattern(canvas, size);

    // Soft light wash — keeps colors vivid instead of crushing to black.
    canvas.drawRect(
      rect,
      Paint()
        ..shader = ui.Gradient.radial(
          Offset(size.width * 0.78, size.height * 0.18),
          size.width * 0.55,
          [Colors.white.withValues(alpha: 0.22), Colors.transparent],
        ),
    );

    // Gentle bottom fade for avatar/text readability (not a black slab).
    canvas.drawRect(
      rect,
      Paint()
        ..shader = ui.Gradient.linear(
          Offset(0, size.height * 0.55),
          Offset(0, size.height),
          [Colors.transparent, Colors.black.withValues(alpha: 0.28)],
        ),
    );
  }

  void _drawPattern(Canvas canvas, Size size) {
    switch (style.pattern) {
      case _CoverPattern.aurora:
        _aurora(canvas, size);
      case _CoverPattern.waves:
        _waves(canvas, size);
      case _CoverPattern.rings:
        _rings(canvas, size);
      case _CoverPattern.beams:
        _beams(canvas, size);
      case _CoverPattern.petals:
        _petals(canvas, size);
      case _CoverPattern.horizon:
        _horizon(canvas, size);
    }
  }

  void _aurora(Canvas canvas, Size size) {
    final paint = Paint()..color = style.accent.withValues(alpha: 0.28);
    final path = Path()
      ..moveTo(0, size.height * 0.55)
      ..quadraticBezierTo(
        size.width * 0.35,
        size.height * (0.15 + seed * 0.02),
        size.width * 0.7,
        size.height * 0.45,
      )
      ..quadraticBezierTo(size.width, size.height * 0.2, size.width, size.height * 0.65)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(path, paint);
  }

  void _waves(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = style.accent.withValues(alpha: 0.35);
    for (var i = 0; i < 4; i++) {
      final path = Path();
      final y = size.height * (0.25 + i * 0.14);
      path.moveTo(0, y);
      for (var x = 0.0; x <= size.width; x += 8) {
        path.lineTo(
          x,
          y + math.sin((x / size.width) * math.pi * 3 + seed + i) * 10,
        );
      }
      canvas.drawPath(path, paint);
    }
  }

  void _rings(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = Colors.white.withValues(alpha: 0.22);
    final center = Offset(size.width * 0.82, size.height * 0.32);
    for (var i = 0; i < 5; i++) {
      canvas.drawCircle(center, 18.0 + i * 16 + seed * 1.5, paint);
    }
  }

  void _beams(Canvas canvas, Size size) {
    final paint = Paint()..color = style.accent.withValues(alpha: 0.18);
    final rnd = math.Random(seed + 7);
    for (var i = 0; i < 6; i++) {
      final x = rnd.nextDouble() * size.width;
      final path = Path()
        ..moveTo(x, -10)
        ..lineTo(x + 40, size.height + 10)
        ..lineTo(x + 18, size.height + 10)
        ..close();
      canvas.drawPath(path, paint);
    }
  }

  void _petals(Canvas canvas, Size size) {
    final paint = Paint()..color = style.accent.withValues(alpha: 0.25);
    final rnd = math.Random(seed + 19);
    for (var i = 0; i < 8; i++) {
      final cx = rnd.nextDouble() * size.width;
      final cy = rnd.nextDouble() * size.height * 0.75;
      canvas.drawCircle(Offset(cx, cy), 14 + rnd.nextDouble() * 22, paint);
    }
  }

  void _horizon(Canvas canvas, Size size) {
    final sun = Paint()..color = style.accent.withValues(alpha: 0.45);
    canvas.drawCircle(Offset(size.width * 0.2, size.height * 0.38), (28 + seed).toDouble(), sun);
    final hill = Paint()..color = Colors.white.withValues(alpha: 0.12);
    final path = Path()
      ..moveTo(0, size.height * 0.72)
      ..quadraticBezierTo(size.width * 0.35, size.height * 0.45, size.width * 0.65, size.height * 0.68)
      ..quadraticBezierTo(size.width * 0.9, size.height * 0.82, size.width, size.height * 0.58)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(path, hill);
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
        childAspectRatio: 1.55,
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
                  TeacherCoverBanner(preset: i, height: 72),
                  if (isSelected)
                    DecoratedBox(
                      decoration: BoxDecoration(
                        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.5), width: 2),
                      ),
                      child: const Align(
                        alignment: Alignment.topRight,
                        child: Padding(
                          padding: EdgeInsets.all(5),
                          child: Icon(Icons.check_circle_rounded, color: Colors.white, size: 20),
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
}

/// Bottom sheet for choosing a teacher profile cover.
Future<void> showTeacherCoverPickerSheet({
  required BuildContext context,
  required int? selected,
  required ValueChanged<int> onSelected,
}) {
  final l10n = context.l10n;
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTheme.card,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) {
      var current = selected ?? 0;
      return StatefulBuilder(
        builder: (ctx, setLocal) {
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 12,
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppTheme.muted.withValues(alpha: 0.35),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    l10n.profileCoverTitle,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    l10n.profileCoverHint,
                    style: TextStyle(color: AppTheme.muted.withValues(alpha: 0.9), fontSize: 13),
                  ),
                  const SizedBox(height: 14),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: TeacherCoverBanner(preset: current, height: 110),
                  ),
                  const SizedBox(height: 16),
                  Flexible(
                    child: SingleChildScrollView(
                      child: TeacherCoverPicker(
                        selected: current,
                        onSelected: (i) {
                          setLocal(() => current = i);
                          onSelected(i);
                        },
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      );
    },
  );
}

Offset _alignOffset(Alignment alignment, Size size) {
  return Offset(
    (alignment.x + 1) / 2 * size.width,
    (alignment.y + 1) / 2 * size.height,
  );
}
