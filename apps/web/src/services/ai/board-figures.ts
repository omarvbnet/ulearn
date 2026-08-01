/**
 * AI board figures — DeepSeek draws directly on the U Learn whiteboard.
 *
 * The model emits [[BOARD]]{json}[[/BOARD]] blocks; we sanitize them into the
 * shared UBRD figure format (1920×1080 logical board, same shape/stroke/text
 * model as apps/web/src/lib/whiteboard and the Flutter whiteboard domain), and
 * both clients paint them natively — no FLUX raster generation involved.
 * The payload is additive (`boardFigures`), so older app versions that don't
 * know the field keep working unchanged.
 */

export const BOARD_FIGURE_WIDTH = 1920;
export const BOARD_FIGURE_HEIGHT = 1080;

const MAX_FIGURES = 3;
const MAX_SHAPES = 60;
const MAX_TEXTS = 40;
const MAX_STROKES = 40;
const MAX_STROKE_POINTS = 300;

const SHAPE_KINDS = new Set(["rect", "circle", "line", "arrow"]);
const DEFAULT_INK = "#111827";

export type BoardFigureShape = {
  id: string;
  kind: "rect" | "circle" | "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
};

export type BoardFigureText = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
};

export type BoardFigureStroke = {
  id: string;
  tool: "pen";
  color: string;
  opacity: number;
  width: number;
  points: Array<{ x: number; y: number }>;
};

export type BoardFigureSpec = {
  schemaVersion: 1;
  format: "ubrd-figure";
  title?: string;
  theme: "WHITE";
  boardWidth: number;
  boardHeight: number;
  shapes: BoardFigureShape[];
  texts: BoardFigureText[];
  strokes: BoardFigureStroke[];
};

/** System-prompt block instructing the model how to draw on the board. */
export function boardFigureInstruction(): string {
  return [
    "When the topic benefits from a diagram/figure, DRAW it on the lesson whiteboard yourself.",
    "For EACH required drawing section add one block exactly like this (valid JSON inside):",
    "[[BOARD]]",
    '{"title":"short caption in the answer language","shapes":[{"kind":"rect","x1":200,"y1":200,"x2":700,"y2":500,"color":"#2563EB","width":5}],"texts":[{"x":230,"y":230,"text":"label","color":"#111827","fontSize":40}],"strokes":[{"color":"#EF4444","width":5,"points":[{"x":100,"y":900},{"x":300,"y":700}]}]}',
    "[[/BOARD]]",
    `Board canvas: ${BOARD_FIGURE_WIDTH}×${BOARD_FIGURE_HEIGHT}, origin top-left, white background.`,
    'Shape kinds: "rect", "circle" (drawn inside its bounding box x1,y1→x2,y2), "line", "arrow" (points from x1,y1 to x2,y2).',
    'Use "strokes" (freehand polylines) only for curves the shapes cannot express.',
    "Plan the layout like a professional teacher at a whiteboard: large elements, generous spacing, no overlapping labels, arrows connecting related parts.",
    "Ink palette: #111827 (main), #2563EB (blue), #EF4444 (red), #22C55E (green), #F59E0B (amber).",
    "Text labels must be short, in the same language as the answer, fontSize 28–56.",
    "Draw 1–3 boards maximum, each focused on ONE idea from the selected material.",
    "Never mention the [[BOARD]] blocks in the prose — the app renders them as drawings automatically.",
  ].join("\n");
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function color(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : DEFAULT_INK;
}

function sanitizeFigure(raw: unknown, index: number): BoardFigureSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const W = BOARD_FIGURE_WIDTH;
  const H = BOARD_FIGURE_HEIGHT;

  const shapes: BoardFigureShape[] = [];
  if (Array.isArray(obj.shapes)) {
    for (const s of obj.shapes.slice(0, MAX_SHAPES)) {
      if (!s || typeof s !== "object") continue;
      const sh = s as Record<string, unknown>;
      const kind = String(sh.kind || "rect").toLowerCase();
      if (!SHAPE_KINDS.has(kind)) continue;
      shapes.push({
        id: `fig${index}_s${shapes.length}`,
        kind: kind as BoardFigureShape["kind"],
        x1: clamp(num(sh.x1, 0), 0, W),
        y1: clamp(num(sh.y1, 0), 0, H),
        x2: clamp(num(sh.x2, 0), 0, W),
        y2: clamp(num(sh.y2, 0), 0, H),
        color: color(sh.color),
        width: clamp(num(sh.width, 5), 1, 24),
      });
    }
  }

  const texts: BoardFigureText[] = [];
  if (Array.isArray(obj.texts)) {
    for (const t of obj.texts.slice(0, MAX_TEXTS)) {
      if (!t || typeof t !== "object") continue;
      const tx = t as Record<string, unknown>;
      const text = String(tx.text ?? "").trim().slice(0, 120);
      if (!text) continue;
      texts.push({
        id: `fig${index}_t${texts.length}`,
        x: clamp(num(tx.x, 0), 0, W),
        y: clamp(num(tx.y, 0), 0, H),
        text,
        color: color(tx.color),
        fontSize: clamp(num(tx.fontSize, 36), 18, 96),
      });
    }
  }

  const strokes: BoardFigureStroke[] = [];
  if (Array.isArray(obj.strokes)) {
    for (const s of obj.strokes.slice(0, MAX_STROKES)) {
      if (!s || typeof s !== "object") continue;
      const st = s as Record<string, unknown>;
      const rawPts = Array.isArray(st.points) ? st.points : [];
      const points: Array<{ x: number; y: number }> = [];
      for (const p of rawPts.slice(0, MAX_STROKE_POINTS)) {
        if (!p || typeof p !== "object") continue;
        const pt = p as Record<string, unknown>;
        points.push({
          x: clamp(num(pt.x, 0), 0, W),
          y: clamp(num(pt.y, 0), 0, H),
        });
      }
      if (points.length < 2) continue;
      strokes.push({
        id: `fig${index}_k${strokes.length}`,
        tool: "pen",
        color: color(st.color),
        opacity: clamp(num(st.opacity, 1), 0.2, 1),
        width: clamp(num(st.width, 5), 1, 24),
        points,
      });
    }
  }

  if (!shapes.length && !strokes.length && !texts.length) return null;

  const title = String(obj.title ?? "").trim().slice(0, 140);
  return {
    schemaVersion: 1,
    format: "ubrd-figure",
    ...(title ? { title } : {}),
    theme: "WHITE",
    boardWidth: W,
    boardHeight: H,
    shapes,
    texts,
    strokes,
  };
}

/**
 * Extract and sanitize [[BOARD]] blocks from model output.
 * Returns the answer text without the blocks plus the parsed figures.
 */
export function extractBoardFigures(markdown: string): {
  cleanMarkdown: string;
  figures: BoardFigureSpec[];
} {
  const figures: BoardFigureSpec[] = [];
  const cleanMarkdown = markdown.replace(
    /\[\[BOARD\]\]([\s\S]*?)\[\[\/BOARD\]\]/gi,
    (_m, inner: string) => {
      if (figures.length >= MAX_FIGURES) return "";
      const raw = String(inner || "")
        .replace(/^```(?:json)?/gim, "")
        .replace(/```$/gim, "")
        .trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start === -1 || end <= start) return "";
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        const fig = sanitizeFigure(parsed, figures.length);
        if (fig) figures.push(fig);
      } catch {
        /* malformed board JSON — drop the block silently */
      }
      return "";
    }
  );
  return {
    cleanMarkdown: cleanMarkdown.replace(/\n{3,}/g, "\n\n").trim(),
    figures,
  };
}
