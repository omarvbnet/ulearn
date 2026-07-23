import 'package:ulearn/features/whiteboard/domain/types.dart';

List<StrokePoint> smoothStrokePoints(List<StrokePoint> points, {int iterations = 2}) {
  if (points.length < 3) return List.of(points);
  var pts = List<StrokePoint>.of(points);
  for (var i = 0; i < iterations; i++) {
    final next = <StrokePoint>[pts.first];
    for (var j = 0; j < pts.length - 1; j++) {
      final a = pts[j];
      final b = pts[j + 1];
      next.add(StrokePoint(
        x: 0.75 * a.x + 0.25 * b.x,
        y: 0.75 * a.y + 0.25 * b.y,
        p: a.p != null && b.p != null ? 0.75 * a.p! + 0.25 * b.p! : a.p ?? b.p,
        t: a.t,
      ));
      next.add(StrokePoint(
        x: 0.25 * a.x + 0.75 * b.x,
        y: 0.25 * a.y + 0.75 * b.y,
        p: a.p != null && b.p != null ? 0.25 * a.p! + 0.75 * b.p! : b.p ?? a.p,
        t: b.t,
      ));
    }
    next.add(pts.last);
    pts = next;
  }
  return pts;
}

double defaultWidthForTool(WhiteboardTool tool) {
  switch (tool) {
    case WhiteboardTool.pencil:
      return 2;
    case WhiteboardTool.highlighter:
      return 18;
    case WhiteboardTool.eraser:
      return 24;
    default:
      return 3.5;
  }
}

double defaultOpacityForTool(WhiteboardTool tool) {
  return tool == WhiteboardTool.highlighter ? 0.35 : 1;
}
