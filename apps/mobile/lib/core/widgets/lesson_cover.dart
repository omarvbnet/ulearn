import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/features/home/home_feed.dart';

/// Smart lesson cover: server thumbnail when available, otherwise a branded
/// procedural cover from the lesson title/id.
class LessonCover extends StatelessWidget {
  const LessonCover({
    super.key,
    required this.lesson,
    this.width = 120,
    this.height = 68,
    this.borderRadius = 10,
    this.showPlay = true,
    this.active = false,
    this.index,
    /// When true, renders only the cover image (no play badge, duration, or index).
    this.coverOnly = false,
  });

  final Map<String, dynamic> lesson;
  final double width;
  final double height;
  final double borderRadius;
  final bool showPlay;
  final bool active;
  final int? index;
  final bool coverOnly;

  static String? resolveThumbnailUrl(Map<String, dynamic> lesson) {
    for (final key in ['thumbnailUrl', 'thumbnail', 'coverUrl', 'posterUrl']) {
      final value = lesson[key]?.toString().trim();
      if (value != null && value.isNotEmpty) return value;
    }
    return null;
  }

  static String resolveTitle(Map<String, dynamic> lesson, {int? index}) {
    final raw = lesson['title']?.toString().trim();
    if (raw != null && raw.isNotEmpty) return raw;
    if (index != null) return 'Lesson ${index + 1}';
    return 'Lesson';
  }

  @override
  Widget build(BuildContext context) {
    final thumb = resolveThumbnailUrl(lesson);
    final duration = (lesson['durationSec'] as num?)?.toInt();
    final displayTitle = resolveTitle(lesson, index: index);
    final id = lesson['id']?.toString() ?? displayTitle;
    final hasThumb = thumb != null && thumb.isNotEmpty;

    final coverLayer = hasThumb
        ? SizedBox.expand(
            child: CachedImage(
              url: thumb,
              fit: BoxFit.cover,
              width: double.infinity,
              height: double.infinity,
              placeholder: _ProceduralCover(id: id, title: displayTitle, index: index),
              error: _ProceduralCover(id: id, title: displayTitle, index: index),
            ),
          )
        : SizedBox.expand(
            child: _ProceduralCover(id: id, title: displayTitle, index: index),
          );

    if (coverOnly) {
      return _wrapSize(
        ClipRRect(
          borderRadius: BorderRadius.circular(borderRadius),
          child: coverLayer,
        ),
      );
    }

    return _wrapSize(
      ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: Stack(
          fit: StackFit.expand,
          children: [
            coverLayer,
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Colors.black.withValues(alpha: 0.08),
                    Colors.black.withValues(alpha: 0.45),
                  ],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
              ),
            ),
            if (index != null)
              Positioned(
                left: 5,
                top: 4,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.55),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Text(
                    '${index! + 1}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            if (showPlay)
              Center(
                child: Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: active
                        ? AppTheme.accent.withValues(alpha: 0.95)
                        : Colors.white.withValues(alpha: 0.22),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: active ? AppTheme.accent : Colors.white70,
                      width: active ? 2 : 1,
                    ),
                  ),
                  child: Icon(
                    active ? Icons.pause_rounded : Icons.play_arrow_rounded,
                    color: Colors.white,
                    size: 18,
                  ),
                ),
              ),
            if (duration != null && duration > 0)
              Positioned(
                right: 5,
                bottom: 4,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.72),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Text(
                    formatDuration(duration),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9,
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

  Widget _wrapSize(Widget child) {
    if (width.isFinite && height.isFinite) {
      return SizedBox(width: width, height: height, child: child);
    }
    return child;
  }
}

/// Strictly bounded thumbnail for lesson list rows (never expands in a [Row]).
class LessonListThumbnail extends StatelessWidget {
  const LessonListThumbnail({
    super.key,
    required this.lesson,
    this.index,
    this.size = 48,
    this.locked = false,
    this.progressPct = 0,
  });

  final Map<String, dynamic> lesson;
  final int? index;
  final double size;
  final bool locked;
  final double progressPct;

  @override
  Widget build(BuildContext context) {
    final thumb = LessonCover.resolveThumbnailUrl(lesson);
    final title = LessonCover.resolveTitle(lesson, index: index);
    final id = lesson['id']?.toString() ?? title;
    final hash = (id.hashCode.abs() + (index ?? 0) * 17);
    final colors = [
      AppTheme.primary,
      AppTheme.accent,
      const Color(0xFF6B21FF),
      const Color(0xFF00C9FF),
    ];
    final c1 = colors[hash % colors.length];
    final c2 = colors[(hash + 1) % colors.length];

    Widget generated() => Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [c1, c2],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: Icon(
            Icons.play_circle_outline_rounded,
            color: Colors.white.withValues(alpha: 0.75),
            size: size * 0.42,
          ),
        );

    return SizedBox(
      width: size,
      height: size,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (thumb != null && thumb.isNotEmpty)
              CachedImage(
                url: thumb,
                width: size,
                height: size,
                fit: BoxFit.cover,
                placeholder: generated(),
                error: generated(),
              )
            else
              generated(),
            if (locked)
              ColoredBox(
                color: Colors.black.withValues(alpha: 0.45),
                child: Icon(
                  Icons.lock_rounded,
                  color: Colors.white.withValues(alpha: 0.85),
                  size: size * 0.36,
                ),
              ),
            if (progressPct > 0 && progressPct < 100)
              Align(
                alignment: Alignment.bottomCenter,
                child: LinearProgressIndicator(
                  value: progressPct / 100,
                  minHeight: 3,
                  backgroundColor: Colors.black45,
                  color: AppTheme.accent,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ProceduralCover extends StatelessWidget {
  const _ProceduralCover({
    required this.id,
    required this.title,
    this.index,
  });

  final String id;
  final String title;
  final int? index;

  @override
  Widget build(BuildContext context) {
    final hash = (id.hashCode.abs() + (index ?? 0) * 17);
    final palette = [
      AppTheme.primary,
      AppTheme.accent,
      const Color(0xFF6B21FF),
      const Color(0xFF00C9FF),
      const Color(0xFFFF6B6B),
      const Color(0xFF38EF7D),
    ];
    final c1 = palette[hash % palette.length];
    final c2 = palette[(hash + 2) % palette.length];
    final c3 = palette[(hash + 4) % palette.length];
    final initial = title.isNotEmpty ? title[0].toUpperCase() : '?';

    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth.isFinite && constraints.maxWidth > 0
            ? constraints.maxWidth
            : 120.0;
        final h = constraints.maxHeight.isFinite && constraints.maxHeight > 0
            ? constraints.maxHeight
            : 68.0;
        return CustomPaint(
          size: Size(w, h),
          painter: _CoverPainter(
            colors: [c1, c2, c3],
            seed: hash,
            label: initial,
          ),
        );
      },
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
          colors.map((c) => c.withValues(alpha: 0.92)).toList(),
        ),
    );

    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = Colors.white.withValues(alpha: 0.18);
    for (var i = 0; i < 4; i++) {
      final r = 14.0 + i * 10 + (seed % 5);
      canvas.drawCircle(
        Offset(size.width * 0.78, size.height * 0.32),
        r,
        ring,
      );
    }

    final px = Paint()..color = Colors.white.withValues(alpha: 0.2);
    for (var i = 0; i < 6; i++) {
      final x = (seed + i * 37) % size.width.toInt();
      final y = (seed + i * 53) % size.height.toInt();
      canvas.drawRect(Rect.fromLTWH(x.toDouble(), y.toDouble(), 3, 3), px);
    }

    final tp = TextPainter(
      text: TextSpan(
        text: label,
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.35),
          fontSize: size.height * 0.5,
          fontWeight: FontWeight.w900,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset(size.width - tp.width - 6, size.height - tp.height + 2));
  }

  @override
  bool shouldRepaint(_CoverPainter old) =>
      old.seed != seed || old.label != label;
}
