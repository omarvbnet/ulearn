import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:ulearn/features/whiteboard/domain/board_state.dart';
import 'package:ulearn/features/whiteboard/domain/types.dart';
import 'package:ulearn/features/whiteboard/ui/board_theme.dart';
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
  })  : // Snapshot mutable BoardState fields — old/new painters share the same
        // instance, so comparing live `state.revision` always looks equal and
        // Flutter skips paint (students only saw ink after a PDF underlay swap).
        _paintRevision = state.revision,
        _openStrokeCount = state.openStrokes.length,
        _theme = state.theme,
        _pageId = state.currentPageId,
        _laserKey = _laserPaintKey(state.laser);

  final BoardState state;
  final double boardWidth;
  final double boardHeight;
  final BoardStroke? activeStroke;
  /// Live shape draft while the teacher is still dragging.
  final BoardShape? activeShape;
  final ui.Image? pdfUnderlay;

  final int _paintRevision;
  final int _openStrokeCount;
  final WhiteboardThemeId _theme;
  final String? _pageId;
  final String _laserKey;

  static String _laserPaintKey(BoardLaser? laser) {
    if (laser == null || !laser.visible) return '';
    return '${laser.pageId}:${laser.x.toStringAsFixed(1)},${laser.y.toStringAsFixed(1)}';
  }

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

    paintBoardSurface(canvas, Size(boardWidth, boardHeight), state.theme);

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

    paint.isAntiAlias = true;

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

    // Quadratic midpoints → smoother ink than raw polyline segments.
    final pts = stroke.points;
    final path = Path()..moveTo(pts.first.x, pts.first.y);
    if (pts.length == 2) {
      path.lineTo(pts[1].x, pts[1].y);
    } else {
      for (var i = 1; i < pts.length - 1; i++) {
        final mid = Offset(
          (pts[i].x + pts[i + 1].x) / 2,
          (pts[i].y + pts[i + 1].y) / 2,
        );
        path.quadraticBezierTo(pts[i].x, pts[i].y, mid.dx, mid.dy);
      }
      path.lineTo(pts.last.x, pts.last.y);
    }
    canvas.drawPath(path, paint);
  }

  void _paintShape(Canvas canvas, BoardShape shape, {bool preview = false}) {
    final paint = Paint()
      ..color = _parseColor(shape.color, opacity: preview ? 0.85 : 1)
      ..style = PaintingStyle.stroke
      ..strokeWidth = shape.width
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..isAntiAlias = true;
    final rect = Rect.fromPoints(Offset(shape.x1, shape.y1), Offset(shape.x2, shape.y2));
    switch (shape.kind) {
      case 'circle':
        canvas.drawOval(rect, paint);
        break;
      case 'line':
        canvas.drawLine(Offset(shape.x1, shape.y1), Offset(shape.x2, shape.y2), paint);
        break;
      case 'arrow':
        canvas.drawLine(Offset(shape.x1, shape.y1), Offset(shape.x2, shape.y2), paint);
        _paintArrowHead(canvas, shape, paint.color);
        break;
      case 'rect':
      case 'rectangle':
        // Sharp rectangle — strokeJoin.miter keeps crisp corners for teachers.
        canvas.drawRect(
          rect,
          paint
            ..strokeJoin = StrokeJoin.miter
            ..strokeMiterLimit = 4,
        );
        break;
      default:
        canvas.drawRect(
          rect,
          paint
            ..strokeJoin = StrokeJoin.miter
            ..strokeMiterLimit = 4,
        );
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

  void _paintArrowHead(Canvas canvas, BoardShape shape, Color color) {
    final dx = shape.x2 - shape.x1;
    final dy = shape.y2 - shape.y1;
    final len = math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    final ux = dx / len;
    final uy = dy / len;
    final head = math.max(shape.width * 3.2, 14.0);
    final px = -uy;
    final py = ux;
    final tip = Offset(shape.x2, shape.y2);
    final left = Offset(
      shape.x2 - ux * head + px * head * 0.45,
      shape.y2 - uy * head + py * head * 0.45,
    );
    final right = Offset(
      shape.x2 - ux * head - px * head * 0.45,
      shape.y2 - uy * head - py * head * 0.45,
    );
    final path = Path()
      ..moveTo(tip.dx, tip.dy)
      ..lineTo(left.dx, left.dy)
      ..lineTo(right.dx, right.dy)
      ..close();
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..style = PaintingStyle.fill
        ..isAntiAlias = true,
    );
  }

  @override
  bool shouldRepaint(covariant WhiteboardPainter oldDelegate) {
    // Live drawing mutates stroke/shape in place — always refresh while active.
    if (activeStroke != null ||
        oldDelegate.activeStroke != null ||
        activeShape != null ||
        oldDelegate.activeShape != null) {
      return true;
    }
    return oldDelegate._paintRevision != _paintRevision ||
        oldDelegate._openStrokeCount != _openStrokeCount ||
        oldDelegate._theme != _theme ||
        oldDelegate._pageId != _pageId ||
        oldDelegate._laserKey != _laserKey ||
        oldDelegate.pdfUnderlay != pdfUnderlay ||
        oldDelegate.boardWidth != boardWidth ||
        oldDelegate.boardHeight != boardHeight;
  }
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
