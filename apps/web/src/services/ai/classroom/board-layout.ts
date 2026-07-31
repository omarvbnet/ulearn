import type { ClassroomBoardAction } from "./types";

function num(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function shortText(raw: unknown, max = 28): string {
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Force a clean classroom board composition:
 * - neat vertical text column (never overlapping)
 * - large, readable handwriting-sized text
 * - diagrams in a separate zone
 * - soft underlines instead of opaque highlight blobs
 * - auto clear when the column is full
 */
export function normalizeBoardActions(
  actions: ClassroomBoardAction[],
  input: {
    rtl: boolean;
    cursorY?: number;
  }
): { actions: ClassroomBoardAction[]; nextCursorY: number; cleared: boolean } {
  let y = Math.max(140, Math.min(880, input.cursorY ?? 160));
  let diagramY = 200;
  let circleRow = 0;
  let cleared = false;
  const out: ClassroomBoardAction[] = [];
  const textX = input.rtl ? 1720 : 120;
  const diagramX = input.rtl ? 380 : 1320;
  const align = input.rtl ? "right" : "left";

  const ensureRoom = (need = 130) => {
    if (y + need <= 980) return;
    out.push({ time: out.length * 480, action: "clear_board", parameters: {} });
    y = 160;
    diagramY = 200;
    cleared = true;
  };

  // Up to 6 sequenced strokes so a teaching beat can feel like a short
  // chalk video (label → draw → emphasize) instead of a single stamp.
  for (const raw of actions.slice(0, 6)) {
    const action = String(raw.action || "")
      .toLowerCase()
      .replace(/\s+/g, "_");
    const p = { ...(raw.parameters || {}) };

    const beatMs = 480;
    if (action === "clear_board" || action === "open_new_board") {
      out.push({ time: out.length * beatMs, action: "clear_board", parameters: {} });
      y = 160;
      diagramY = 200;
      circleRow = 0;
      cleared = true;
      continue;
    }

    if (
      action === "write_text" ||
      action === "draw_formula" ||
      action === "draw_equation"
    ) {
      const text = shortText(p.text ?? p.content ?? p.latex, 36);
      if (!text) continue;
      ensureRoom(140);
      // Large classroom chalk size — readable on phone and desktop.
      const size = Math.max(48, Math.min(64, num(p.size, text.length < 12 ? 60 : 52)));
      out.push({
        time: out.length * 480,
        action: "write_text",
        parameters: {
          text,
          x: textX,
          y,
          size,
          color: String(p.color || "blue"),
          align,
        },
      });
      y += Math.max(120, size + 68);
      circleRow = 0;
      continue;
    }

    if (action === "circle_highlight" || action === "circle_text") {
      // Coordinates are illustrative only — the client renderer positions
      // this around the actual last-written text item it tracks locally.
      // What matters here is that the action survives normalization instead
      // of being silently dropped like an unrecognized action would be.
      out.push({
        time: out.length * 480,
        action: "circle_highlight",
        parameters: { color: String(p.color || "red") },
      });
      continue;
    }

    if (action === "point_at" || action === "point") {
      out.push({
        time: out.length * 480,
        action: "point_at",
        parameters: { color: String(p.color || "blue") },
      });
      continue;
    }

    if (action === "underline" || action === "highlight") {
      // Convert heavy highlights into a thin underline under the last text line.
      const underlineY = Math.max(150, y - 72);
      out.push({
        time: out.length * 480,
        action: "underline",
        parameters: {
          x1: input.rtl ? textX : textX,
          y1: underlineY,
          x2: input.rtl ? textX - 520 : textX + 520,
          y2: underlineY,
          color: action === "highlight" ? "orange" : String(p.color || "orange"),
          width: 4.2,
        },
      });
      continue;
    }

    if (action === "draw_line") {
      ensureRoom(20);
      const ly = Math.min(980, diagramY);
      out.push({
        time: out.length * 480,
        action: "draw_line",
        parameters: {
          x1: diagramX - 80,
          y1: ly,
          x2: diagramX + 160,
          y2: ly,
          color: String(p.color || "black"),
          width: 3,
        },
      });
      diagramY += 70;
      continue;
    }

    if (action === "draw_arrow") {
      const ay = Math.min(900, diagramY + 40);
      out.push({
        time: out.length * 480,
        action: "draw_arrow",
        parameters: {
          x1: diagramX - 40,
          y1: ay + 80,
          x2: diagramX + 140,
          y2: ay,
          color: String(p.color || "green"),
          width: 3.4,
        },
      });
      diagramY += 140;
      continue;
    }

    if (action === "draw_circle" || action === "circle") {
      const cy = Math.min(860, diagramY + 60);
      const r = Math.max(36, Math.min(70, num(p.r, 55)));
      // Counting circles sit in a horizontal row like a teacher tallying
      // objects — not stacked/overlapping down the diagram column.
      const cx = input.rtl
        ? diagramX + 40 - circleRow * (r * 2 + 24)
        : diagramX + 40 + circleRow * (r * 2 + 24);
      out.push({
        time: out.length * 480,
        action: "draw_circle",
        parameters: {
          cx,
          cy,
          r,
          color: String(p.color || "red"),
          width: 3.2,
        },
      });
      circleRow += 1;
      if (circleRow >= 4) {
        circleRow = 0;
        diagramY += r * 2 + 50;
      }
      continue;
    }

    if (action === "draw_rectangle" || action === "draw_rect") {
      const ry = Math.min(860, diagramY);
      out.push({
        time: out.length * 480,
        action: "draw_rectangle",
        parameters: {
          x: diagramX - 40,
          y: ry,
          w: 200,
          h: 90,
          color: String(p.color || "brown"),
          width: 3,
        },
      });
      diagramY += 130;
    }
  }

  return { actions: out, nextCursorY: y, cleared };
}
