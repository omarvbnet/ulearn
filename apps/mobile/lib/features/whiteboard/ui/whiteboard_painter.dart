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
    this.pdfUnderlay,
  });

  final BoardState state;
  final double boardWidth;
  final double boardHeight;
  final BoardStroke? activeStroke;
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
      paintPdfContain(
        canvas,
        pdfUnderlay!,
        Rect.fromLTWH(0, 0, boardWidth, boardHeight),
      );
    }

    for (final shape in page.shapes) {
      _paintShape(canvas, shape);
    }
    for (final stroke in page.strokes) {
      _paintStroke(canvas, stroke);
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
    final path = Path();
    path.moveTo(stroke.points.first.x, stroke.points.first.y);
    for (var i = 1; i < stroke.points.length; i++) {
      final p = stroke.points[i];
      path.lineTo(p.x, p.y);
    }
    final paint = Paint()
      ..color = _parseColor(stroke.color, opacity: stroke.opacity)
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
    canvas.drawPath(path, paint);
  }

  void _paintShape(Canvas canvas, BoardShape shape) {
    final paint = Paint()
      ..color = _parseColor(shape.color)
      ..style = PaintingStyle.stroke
      ..strokeWidth = shape.width
      ..strokeCap = StrokeCap.round;
    final rect = Rect.fromPoints(Offset(shape.x1, shape.y1), Offset(shape.x2, shape.y2));
    switch (shape.kind) {
      case 'circle':
        canvas.drawOval(rect, paint);
        break;
      case 'line':
      case 'arrow':
        canvas.drawLine(Offset(shape.x1, shape.y1), Offset(shape.x2, shape.y2), paint);
        if (shape.kind == 'arrow') {
          canvas.drawCircle(Offset(shape.x2, shape.y2), shape.width * 1.2, paint..style = PaintingStyle.fill);
        }
        break;
      default:
        canvas.drawRect(rect, paint);
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
