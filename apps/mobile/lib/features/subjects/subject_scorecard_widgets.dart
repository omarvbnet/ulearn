import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Picks the subject display name for the current locale, matching the web
/// `getLocalizedField` convention (nameEn/nameAr/nameKu/nameTr, falling back
/// to English).
String localizedSubjectName(dynamic subjectName, String localeCode) {
  if (subjectName is! Map) return '';
  final key = 'name${localeCode[0].toUpperCase()}${localeCode.substring(1).toLowerCase()}';
  return (subjectName[key] as String?)?.trim().isNotEmpty == true
      ? subjectName[key] as String
      : (subjectName['nameEn'] as String?) ?? '';
}

Color performanceLevelColor(String level) {
  switch (level) {
    case 'EXPERT':
      return Colors.greenAccent;
    case 'ADVANCED':
      return Colors.lightBlueAccent;
    case 'INTERMEDIATE':
      return AppTheme.accent;
    case 'DEVELOPING':
      return Colors.amberAccent;
    case 'BASIC':
      return Colors.orangeAccent;
    default:
      return Colors.redAccent;
  }
}

Color trendColor(String trend) {
  switch (trend) {
    case 'RAPID_IMPROVEMENT':
    case 'STEADY_IMPROVEMENT':
      return Colors.greenAccent;
    case 'STABLE':
      return AppTheme.muted;
    case 'SLIGHT_DECLINE':
      return Colors.amberAccent;
    default:
      return Colors.redAccent;
  }
}

String trendArrow(String trend) {
  switch (trend) {
    case 'RAPID_IMPROVEMENT':
      return '↑↑';
    case 'STEADY_IMPROVEMENT':
      return '↑';
    case 'STABLE':
      return '→';
    case 'SLIGHT_DECLINE':
      return '↓';
    default:
      return '↓↓';
  }
}

/// Circular percentage gauge — mirrors the web `CircularGauge` component.
class CircularScoreGauge extends StatelessWidget {
  const CircularScoreGauge({
    super.key,
    required this.percent,
    this.label,
    this.size = 84,
    this.strokeWidth = 8,
    this.color = AppTheme.accent,
  });

  final int percent;
  final String? label;
  final double size;
  final double strokeWidth;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final clamped = percent.clamp(0, 100);
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          CustomPaint(
            size: Size(size, size),
            painter: _GaugePainter(percent: clamped.toDouble(), strokeWidth: strokeWidth, color: color),
          ),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('$clamped%', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              if (label != null)
                Text(label!, style: TextStyle(color: AppTheme.muted, fontSize: 9)),
            ],
          ),
        ],
      ),
    );
  }
}

class _GaugePainter extends CustomPainter {
  _GaugePainter({required this.percent, required this.strokeWidth, required this.color});

  final double percent;
  final double strokeWidth;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (math.min(size.width, size.height) - strokeWidth) / 2;
    final track = Paint()
      ..color = Colors.white.withValues(alpha: 0.1)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    canvas.drawCircle(center, radius, track);

    final arc = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;
    final sweep = 2 * math.pi * (percent / 100);
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      sweep,
      false,
      arc,
    );
  }

  @override
  bool shouldRepaint(covariant _GaugePainter oldDelegate) =>
      oldDelegate.percent != percent || oldDelegate.color != color;
}

/// A dimension row: label, either a percentage bar or a "not enough data"
/// empty state, with an optional "estimated" tag.
class ScoreRow extends StatelessWidget {
  const ScoreRow({
    super.key,
    required this.label,
    required this.percent,
    this.estimated = false,
    this.hint,
    required this.notEnoughDataLabel,
    required this.estimatedLabel,
  });

  final String label;
  final int? percent;
  final bool estimated;
  final String? hint;
  final String notEnoughDataLabel;
  final String estimatedLabel;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Row(
                  children: [
                    Flexible(
                      child: Text(
                        label,
                        style: TextStyle(color: AppTheme.muted, fontSize: 12),
                      ),
                    ),
                    if (estimated && percent != null) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          border: Border.all(color: AppTheme.muted.withValues(alpha: 0.4)),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          estimatedLabel,
                          style: TextStyle(fontSize: 9, color: AppTheme.muted),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Text(
                percent != null ? '$percent%' : notEnoughDataLabel,
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                  color: percent != null ? null : AppTheme.muted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: LinearProgressIndicator(
              value: percent != null ? percent!.clamp(2, 100) / 100 : 0,
              minHeight: 6,
              backgroundColor: AppTheme.cardBorder,
              valueColor: AlwaysStoppedAnimation(
                percent != null ? AppTheme.accent : AppTheme.cardBorder,
              ),
            ),
          ),
          if (hint != null) ...[
            const SizedBox(height: 3),
            Text(hint!, style: TextStyle(color: AppTheme.muted.withValues(alpha: 0.8), fontSize: 10)),
          ],
        ],
      ),
    );
  }
}

/// Lightweight trend sparkline — a simple custom painter, consistent with
/// the existing whiteboard/board painters, avoiding a new chart dependency.
class TrendSparkline extends StatelessWidget {
  const TrendSparkline({super.key, required this.points, this.height = 120});

  /// List of 0-100 mastery values, oldest first.
  final List<num> points;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      width: double.infinity,
      child: CustomPaint(
        painter: _SparklinePainter(points: points.map((p) => p.toDouble()).toList()),
      ),
    );
  }
}

class _SparklinePainter extends CustomPainter {
  _SparklinePainter({required this.points});

  final List<double> points;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2) return;
    final path = Path();
    final fillPath = Path();
    final stepX = size.width / (points.length - 1);

    Offset pointAt(int i) {
      final normalized = (points[i] / 100).clamp(0.0, 1.0);
      final y = size.height - normalized * size.height;
      return Offset(i * stepX, y);
    }

    path.moveTo(pointAt(0).dx, pointAt(0).dy);
    fillPath.moveTo(pointAt(0).dx, size.height);
    fillPath.lineTo(pointAt(0).dx, pointAt(0).dy);
    for (var i = 1; i < points.length; i++) {
      final p = pointAt(i);
      path.lineTo(p.dx, p.dy);
      fillPath.lineTo(p.dx, p.dy);
    }
    fillPath.lineTo(pointAt(points.length - 1).dx, size.height);
    fillPath.close();

    final fillPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [AppTheme.accent.withValues(alpha: 0.35), AppTheme.accent.withValues(alpha: 0.0)],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height));
    canvas.drawPath(fillPath, fillPaint);

    final linePaint = Paint()
      ..color = AppTheme.accent
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(path, linePaint);
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter oldDelegate) =>
      oldDelegate.points != points;
}
