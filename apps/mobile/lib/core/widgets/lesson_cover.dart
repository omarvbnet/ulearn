import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/home/home_feed.dart';

/// Smart lesson cover: uses a server thumbnail when available, otherwise
/// generates a branded procedural cover from the lesson title/id.
class LessonCover extends StatelessWidget {
  const LessonCover({
    super.key,
    required this.lesson,
    this.width = 120,
    this.height = 68,
    this.borderRadius = 10,
    this.showPlay = true,
    this.active = false,
  });

  final Map<String, dynamic> lesson;
  final double width;
  final double height;
  final double borderRadius;
  final bool showPlay;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final thumb = lesson['thumbnailUrl']?.toString();
    final duration = (lesson['durationSec'] as num?)?.toInt();
    final title = lesson['title']?.toString() ?? 'Lesson';
    final id = lesson['id']?.toString() ?? title;

    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: SizedBox(
        width: width,
        height: height,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (thumb != null && thumb.isNotEmpty)
              CachedImage(
                url: thumb,
                fit: BoxFit.cover,
                placeholder: _ProceduralCover(id: id, title: title),
                error: _ProceduralCover(id: id, title: title),
              )
            else
              _ProceduralCover(id: id, title: title),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Colors.black.withValues(alpha: 0.05),
                    Colors.black.withValues(alpha: 0.55),
                  ],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
              ),
            ),
            if (showPlay)
              Center(
                child: Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: active
                        ? AppTheme.accent.withValues(alpha: 0.95)
                        : Colors.white.withValues(alpha: 0.18),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: active ? AppTheme.accent : Colors.white54,
                      width: active ? 2 : 1,
                    ),
                  ),
                  child: Icon(
                    active ? Icons.pause_rounded : Icons.play_arrow_rounded,
                    color: Colors.white,
                    size: 20,
                  ),
                ),
              ),
            if (duration != null && duration > 0)
              Positioned(
                right: 6,
                bottom: 5,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.72),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    formatDuration(duration),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            if (active)
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.all(color: AppTheme.accent, width: 2),
                    borderRadius: BorderRadius.circular(borderRadius),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ProceduralCover extends StatelessWidget {
  const _ProceduralCover({required this.id, required this.title});

  final String id;
  final String title;

  @override
  Widget build(BuildContext context) {
    final hash = id.hashCode.abs();
    final c1 = Color(0xFF600000 + (hash % 0x40) * 0x10000 + (hash % 0x80) * 0x100);
    final c2 = Color(0xFF002040 + (hash % 0x60) * 0x100 + (hash % 0x40));
    final c3 = Color(0xFF200040 + (hash % 0x50) * 0x10000);

    return CustomPaint(
      painter: _CoverPainter(
        colors: [c1, c2, c3],
        seed: hash,
        label: title.isNotEmpty ? title[0].toUpperCase() : '?',
      ),
    );
  }
}

class _CoverPainter extends CustomPainter {
  _CoverPainter({
    required this.colors,
    required this.seed,
    required this.label,
  });

  final List<Color> colors;
  final int seed;
  final String label;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = ui.Gradient.linear(
          Offset.zero,
          Offset(size.width, size.height),
          colors,
        ),
    );

    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = Colors.white.withValues(alpha: 0.08);
    for (var i = 0; i < 5; i++) {
      final r = 18.0 + i * 14 + (seed % 7);
      canvas.drawCircle(
        Offset(size.width * 0.78, size.height * 0.28),
        r,
        ring,
      );
    }

    final px = Paint()..color = Colors.white.withValues(alpha: 0.12);
    for (var i = 0; i < 8; i++) {
      final x = (seed + i * 37) % size.width.toInt();
      final y = (seed + i * 53) % size.height.toInt();
      canvas.drawRect(Rect.fromLTWH(x.toDouble(), y.toDouble(), 4, 4), px);
    }

    final tp = TextPainter(
      text: TextSpan(
        text: label,
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.22),
          fontSize: size.height * 0.55,
          fontWeight: FontWeight.w900,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset(size.width - tp.width - 8, size.height - tp.height + 4));
  }

  @override
  bool shouldRepaint(_CoverPainter old) =>
      old.seed != seed || old.label != label;
}
