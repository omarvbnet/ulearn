import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:ulearn/features/whiteboard/domain/board_state.dart';
import 'package:ulearn/features/whiteboard/domain/types.dart';
import 'package:ulearn/features/whiteboard/ui/pdf_underlay.dart';

Color _parseColor(String hex, {double opacity = 1}) {
  var h = hex.replaceAll('#', '');
  if (h.length == 6) h = 'FF$h';
  final v = int.tryParse(h, radix: 16) ?? 0xFF111827;
  return Color(v).withValues(alpha: opacity.clamp(0.0, 1.0));
}

class WhiteboardPainter extends CustomPainter {
  WhiteboardPainter({
    required this.state,
    required this.boardWidth,
    required this.boardHeight,
    this.activeStroke,
    this.activeShape,
    this.pdfUnderlay,
  });

  final BoardState state;
  final double boardWidth;
  final double boardHeight;
  final BoardStroke? activeStroke;
  /// Live shape draft while the teacher is still dragging.
  final BoardShape? activeShape;
  final ui.Image? pdfUnderlay;

  @override
  void paint(Canvas canvas, Size size) {
    final scale = (size.width / boardWidth).clamp(0.0, 100.0);
    final scaleY = size.height / boardHeight;
    final s = scale < scaleY ? scale : scaleY;
    final dx = (size.width - boardWidth * s) / 2;
    final dy = (size.height - boardHeight * s) / 2;

    canvas.save();
    canvas.translate(dx, dy);
    canvas.scale(s);

    final bg = state.theme == WhiteboardThemeId.black
        ? const Color(0xFF0B0F14)
        : const Color(0xFFF8FAFC);
    canvas.drawRect(Rect.fromLTWH(0, 0, boardWidth, boardHeight), Paint()..color = bg);

    final page = state.currentPage;
    if (page == null) {
      canvas.restore();
      return;
    }

    if (page.kind == 'pdf' && pdfUnderlay != null) {
      final zoom = page.pdfZoom.clamp(0.5, 5.0);
      canvas.save();
      canvas.translate(boardWidth / 2, boardHeight / 2);
      canvas.scale(zoom);
      canvas.translate(-boardWidth / 2, -boardHeight / 2);
      paintPdfContain(
        canvas,
        pdfUnderlay!,
        Rect.fromLTWH(0, 0, boardWidth, boardHeight),
      );
      canvas.restore();
    }

    for (final shape in page.shapes) {
      _paintShape(canvas, shape);
    }
    if (activeShape != null && activeShape!.pageId == page.id) {
      _paintShape(canvas, activeShape!, preview: true);
    }

    for (final stroke in page.strokes) {
      _paintStroke(canvas, stroke);
    }
    // Progressive playback: show in-progress strokes as points arrive.
    for (final stroke in state.openStrokes.values) {
      if (stroke.pageId == page.id) _paintStroke(canvas, stroke);
    }
    if (activeStroke != null && activeStroke!.pageId == page.id) {
      _paintStroke(canvas, activeStroke!);
    }
    for (final text in page.texts) {
      final tp = TextPainter(
        text: TextSpan(
          text: text.text,
          style: TextStyle(
            color: _parseColor(text.color),
            fontSize: text.fontSize,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: boardWidth * 0.6);
      tp.paint(canvas, Offset(text.x, text.y));
    }

    final laser = state.laser;
    if (laser != null && laser.visible && laser.pageId == page.id) {
      canvas.drawCircle(
        Offset(laser.x, laser.y),
        10,
        Paint()
          ..color = const Color(0xE0EF4444)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6),
      );
      canvas.drawCircle(Offset(laser.x, laser.y), 4, Paint()..color = const Color(0xFFFF6B6B));
    }

    canvas.restore();
  }

  void _paintStroke(Canvas canvas, BoardStroke stroke) {
    if (stroke.points.isEmpty) return;
    final color = _parseColor(stroke.color, opacity: stroke.opacity);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..strokeWidth = stroke.width
      ..blendMode = stroke.tool == WhiteboardTool.highlighter
          ? BlendMode.multiply
          : BlendMode.srcOver;
    if (stroke.tool == WhiteboardTool.eraser) {
      paint.blendMode = BlendMode.clear;
      paint.color = const Color(0xFFFFFFFF);
    }

    // Tap / single sample → visible round dot (same as press start).
    if (stroke.points.length == 1) {
      final p = stroke.points.first;
      canvas.drawCircle(
        Offset(p.x, p.y),
        math.max(stroke.width / 2, 2.5),
        paint..style = PaintingStyle.fill,
      );
      return;
    }

    final path = Path();
    path.moveTo(stroke.points.first.x, stroke.points.first.y);
    for (var i = 1; i < stroke.points.length; i++) {
      final p = stroke.points[i];
      path.lineTo(p.x, p.y);
    }
    canvas.drawPath(path, paint);
  }

  void _paintShape(Canvas canvas, BoardShape shape, {bool preview = false}) {
    final paint = Paint()
      ..color = _parseColor(shape.color, opacity: preview ? 0.85 : 1)
      ..style = PaintingStyle.stroke
      ..strokeWidth = shape.width
      ..strokeCap = StrokeCap.round;
    if (preview) {
      paint.strokeWidth = shape.width;
    }
    final rect = Rect.fromPoints(Offset(shape.x1, shape.y1), Offset(shape.x2, shape.y2));
    switch (shape.kind) {
      case 'circle':
        canvas.drawOval(rect, paint);
        break;
      case 'line':
      case 'arrow':
        canvas.drawLine(Offset(shape.x1, shape.y1), Offset(shape.x2, shape.y2), paint);
        if (shape.kind == 'arrow') {
          canvas.drawCircle(
            Offset(shape.x2, shape.y2),
            shape.width * 1.2,
            Paint()
              ..color = paint.color
              ..style = PaintingStyle.fill,
          );
        }
        break;
      default:
        canvas.drawRect(rect, paint);
    }

    if (preview) {
      final w = (shape.x2 - shape.x1).abs();
      final h = (shape.y2 - shape.y1).abs();
      final label = shape.kind == 'line' || shape.kind == 'arrow'
          ? '${math.sqrt(w * w + h * h).round()} px'
          : '${w.round()} × ${h.round()}';
      final tp = TextPainter(
        text: TextSpan(
          text: label,
          style: TextStyle(
            color: _parseColor(shape.color),
            fontSize: 22,
            fontWeight: FontWeight.w600,
            backgroundColor: const Color(0xCCFFFFFF),
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      final lx = math.max(shape.x1, shape.x2) + 8;
      final ly = math.min(shape.y1, shape.y2) - 8;
      tp.paint(canvas, Offset(lx.clamp(0, boardWidth - tp.width), ly.clamp(0, boardHeight - tp.height)));
    }
  }

  @override
  bool shouldRepaint(covariant WhiteboardPainter oldDelegate) => true;
}

/// Maps a local pointer position into logical board coordinates.
Offset? logicalFromLocal(Offset local, Size viewSize, double boardW, double boardH) {
  final scaleX = viewSize.width / boardW;
  final scaleY = viewSize.height / boardH;
  final s = scaleX < scaleY ? scaleX : scaleY;
  final dx = (viewSize.width - boardW * s) / 2;
  final dy = (viewSize.height - boardH * s) / 2;
  final x = (local.dx - dx) / s;
  final y = (local.dy - dy) / s;
  if (x < -40 || y < -40 || x > boardW + 40 || y > boardH + 40) return null;
  return Offset(x.clamp(0, boardW), y.clamp(0, boardH));
}
