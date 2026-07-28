import type { StrokePoint } from "./types";

/** Chaikin-ish + pressure-aware polyline smoothing for natural handwriting. */
export function smoothStrokePoints(
  points: StrokePoint[],
  iterations = 2
): StrokePoint[] {
  if (points.length < 3) return points.slice();
  let pts = points.slice();
  for (let i = 0; i < iterations; i++) {
    const next: StrokePoint[] = [pts[0]!];
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j]!;
      const b = pts[j + 1]!;
      next.push({
        x: 0.75 * a.x + 0.25 * b.x,
        y: 0.75 * a.y + 0.25 * b.y,
        p: a.p != null && b.p != null ? 0.75 * a.p + 0.25 * b.p : a.p ?? b.p,
        t: a.t,
      });
      next.push({
        x: 0.25 * a.x + 0.75 * b.x,
        y: 0.25 * a.y + 0.75 * b.y,
        p: a.p != null && b.p != null ? 0.25 * a.p + 0.75 * b.p : b.p ?? a.p,
        t: b.t,
      });
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

/** Discrete pen thicknesses teachers can pick in the studio tool rail. */
export const STROKE_WIDTH_PRESETS = [1.5, 3.5, 6, 10, 16] as const;

export function defaultWidthForTool(tool: string): number {
  switch (tool) {
    case "pencil":
      return 2;
    case "highlighter":
      return 18;
    case "eraser":
      return 24;
    case "pen":
    default:
      return 3.5;
  }
}

/** Width used when drawing with [tool], honoring an optional teacher preset. */
export function resolveStrokeWidth(tool: string, preset?: number | null): number {
  if (tool === "eraser") return defaultWidthForTool(tool);
  if (preset == null) return defaultWidthForTool(tool);
  if (tool === "highlighter") return Math.min(36, Math.max(10, preset * 3.2));
  if (tool === "pencil") return Math.min(12, Math.max(1, preset * 0.75));
  return preset;
}

export function defaultOpacityForTool(tool: string): number {
  return tool === "highlighter" ? 0.35 : 1;
}
