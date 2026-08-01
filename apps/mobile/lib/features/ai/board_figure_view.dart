import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/whiteboard/domain/board_state.dart';
import 'package:ulearn/features/whiteboard/domain/types.dart';
import 'package:ulearn/features/whiteboard/ui/whiteboard_painter.dart';

/// Renders one AI-drawn whiteboard figure (ubrd-figure spec) in the chat.
/// Reuses the shared UBRD board model + painter so drawings look identical
/// to the teacher whiteboard on every platform.
class BoardFigureView extends StatelessWidget {
  BoardFigureView({super.key, required Map<String, dynamic> spec})
      : _title = spec['title']?.toString() ?? '',
        _boardWidth =
            (spec['boardWidth'] as num?)?.toDouble() ?? kLogicalBoardWidth,
        _boardHeight =
            (spec['boardHeight'] as num?)?.toDouble() ?? kLogicalBoardHeight,
        _state = _buildState(spec);

  final String _title;
  final double _boardWidth;
  final double _boardHeight;
  final BoardState _state;

  static double _num(dynamic v, double fallback) =>
      v is num ? v.toDouble() : fallback;

  static BoardState _buildState(Map<String, dynamic> spec) {
    final state = BoardState();
    final page = state.currentPage;
    if (page == null) return state;

    final shapes = spec['shapes'];
    if (shapes is List) {
      var i = 0;
      for (final raw in shapes) {
        if (raw is! Map) continue;
        final s = Map<String, dynamic>.from(raw);
        page.shapes.add(BoardShape(
          id: s['id']?.toString() ?? 'fig_s${i++}',
          pageId: page.id,
          kind: s['kind']?.toString() ?? 'rect',
          x1: _num(s['x1'], 0),
          y1: _num(s['y1'], 0),
          x2: _num(s['x2'], 0),
          y2: _num(s['y2'], 0),
          color: s['color']?.toString() ?? '#111827',
          width: _num(s['width'], 5),
        ));
      }
    }

    final strokes = spec['strokes'];
    if (strokes is List) {
      var i = 0;
      for (final raw in strokes) {
        if (raw is! Map) continue;
        final s = Map<String, dynamic>.from(raw);
        final rawPoints = s['points'];
        final points = <StrokePoint>[];
        if (rawPoints is List) {
          for (final p in rawPoints) {
            if (p is! Map) continue;
            points.add(StrokePoint(
              x: _num(p['x'], 0),
              y: _num(p['y'], 0),
            ));
          }
        }
        if (points.length < 2) continue;
        page.strokes.add(BoardStroke(
          id: s['id']?.toString() ?? 'fig_k${i++}',
          pageId: page.id,
          tool: WhiteboardTool.pen,
          color: s['color']?.toString() ?? '#111827',
          opacity: _num(s['opacity'], 1).clamp(0.2, 1.0),
          width: _num(s['width'], 5),
          points: points,
        ));
      }
    }

    final texts = spec['texts'];
    if (texts is List) {
      var i = 0;
      for (final raw in texts) {
        if (raw is! Map) continue;
        final t = Map<String, dynamic>.from(raw);
        final text = t['text']?.toString() ?? '';
        if (text.isEmpty) continue;
        page.texts.add(BoardText(
          id: t['id']?.toString() ?? 'fig_t${i++}',
          pageId: page.id,
          x: _num(t['x'], 0),
          y: _num(t['y'], 0),
          text: text,
          color: t['color']?.toString() ?? '#111827',
          fontSize: _num(t['fontSize'], 36),
        ));
      }
    }

    state.revision++;
    return state;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AspectRatio(
            aspectRatio: _boardWidth / _boardHeight,
            child: CustomPaint(
              painter: WhiteboardPainter(
                state: _state,
                boardWidth: _boardWidth,
                boardHeight: _boardHeight,
              ),
            ),
          ),
          if (_title.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
              child: Text(
                _title,
                style: const TextStyle(
                  color: Color(0xFF475569),
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
