import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:ulearn/features/whiteboard/domain/types.dart';

/// Visual tokens for classroom-style board surfaces.
class BoardThemeStyle {
  const BoardThemeStyle({
    required this.surface,
    required this.surfaceDeep,
    required this.chromeBg,
    required this.chromeFg,
    required this.defaultInk,
    required this.label,
  });

  final Color surface;
  final Color surfaceDeep;
  final Color chromeBg;
  final Color chromeFg;
  final String defaultInk;
  final String label;
}

BoardThemeStyle boardThemeStyle(WhiteboardThemeId theme) {
  switch (theme) {
    case WhiteboardThemeId.green:
      return const BoardThemeStyle(
        surface: Color(0xFF1A5C3A),
        surfaceDeep: Color(0xFF0E3A24),
        chromeBg: Color(0xFF0F2F1E),
        chromeFg: Color(0xFFF1F5F9),
        defaultInk: '#F8FAFC',
        label: 'Green board',
      );
    case WhiteboardThemeId.black:
      return const BoardThemeStyle(
        surface: Color(0xFF1A1D24),
        surfaceDeep: Color(0xFF0B0D12),
        chromeBg: Color(0xFF111827),
        chromeFg: Color(0xFFF8FAFC),
        defaultInk: '#F8FAFC',
        label: 'Blackboard',
      );
    case WhiteboardThemeId.white:
      return const BoardThemeStyle(
        surface: Color(0xFFF7F8FA),
        surfaceDeep: Color(0xFFE8EDF4),
        chromeBg: Color(0xFFEEF2F7),
        chromeFg: Color(0xFF0F172A),
        defaultInk: '#111827',
        label: 'Whiteboard',
      );
  }
}

/// Paints a realistic classroom board face into [rect] (logical board coords).
void paintBoardSurface(
  Canvas canvas,
  Size boardSize,
  WhiteboardThemeId theme,
) {
  final style = boardThemeStyle(theme);
  final rect = Rect.fromLTWH(0, 0, boardSize.width, boardSize.height);

  final fill = Paint()
    ..shader = ui.Gradient.linear(
      Offset(0, 0),
      Offset(boardSize.width * 0.15, boardSize.height),
      [style.surface, style.surfaceDeep],
    );
  canvas.drawRect(rect, fill);

  // Soft vignette for depth (like a real board under classroom light).
  final vignette = Paint()
    ..shader = ui.Gradient.radial(
      Offset(boardSize.width / 2, boardSize.height * 0.42),
      boardSize.width * 0.72,
      [
        const Color(0x00000000),
        Color.fromRGBO(0, 0, 0, theme == WhiteboardThemeId.white ? 0.06 : 0.28),
      ],
    );
  canvas.drawRect(rect, vignette);

  if (theme == WhiteboardThemeId.white) {
    // Faint ruled lines like a classroom whiteboard.
    final line = Paint()
      ..color = const Color(0x140F172A)
      ..strokeWidth = 1.2;
    const step = 48.0;
    for (var y = step; y < boardSize.height; y += step) {
      canvas.drawLine(Offset(24, y), Offset(boardSize.width - 24, y), line);
    }
  } else {
    // Subtle chalk-dust grain.
    final dust = Paint()..color = const Color(0x14FFFFFF);
    final rng = math.Random(theme == WhiteboardThemeId.green ? 17 : 42);
    for (var i = 0; i < 140; i++) {
      final x = rng.nextDouble() * boardSize.width;
      final y = rng.nextDouble() * boardSize.height;
      canvas.drawCircle(Offset(x, y), rng.nextDouble() * 1.8 + 0.4, dust);
    }
    // Bottom chalk rail.
    final rail = Paint()
      ..shader = ui.Gradient.linear(
        Offset(0, boardSize.height - 28),
        Offset(0, boardSize.height),
        [
          const Color(0x00FFFFFF),
          Color.fromRGBO(255, 255, 255, theme == WhiteboardThemeId.green ? 0.1 : 0.08),
        ],
      );
    canvas.drawRect(
      Rect.fromLTWH(0, boardSize.height - 28, boardSize.width, 28),
      rail,
    );
  }

  // Inner bezel / frame edge.
  final bezel = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 10
    ..color = theme == WhiteboardThemeId.white
        ? const Color(0x22101827)
        : const Color(0x33000000);
  canvas.drawRect(rect.deflate(5), bezel);
}
