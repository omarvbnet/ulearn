import type { ClassroomBoardAction } from "./types";

function num(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function shortText(raw: unknown, max = 42): string {
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Force a clean classroom board composition:
 * - neat vertical text column (never overlapping)
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
  let y = Math.max(120, Math.min(900, input.cursorY ?? 140));
  let diagramY = 180;
  let cleared = false;
  const out: ClassroomBoardAction[] = [];
  const textX = input.rtl ? 1760 : 150;
  const diagramX = input.rtl ? 420 : 1380;
  const align = input.rtl ? "right" : "left";

  const ensureRoom = (need = 100) => {
    if (y + need <= 980) return;
    out.push({ time: out.length * 200, action: "clear_board", parameters: {} });
    y = 140;
    diagramY = 180;
    cleared = true;
  };

  for (const raw of actions.slice(0, 4)) {
    const action = String(raw.action || "")
      .toLowerCase()
      .replace(/\s+/g, "_");
    const p = { ...(raw.parameters || {}) };

    if (action === "clear_board" || action === "open_new_board") {
      out.push({ time: out.length * 200, action: "clear_board", parameters: {} });
      y = 140;
      diagramY = 180;
      cleared = true;
      continue;
    }

    if (
      action === "write_text" ||
      action === "draw_formula" ||
      action === "draw_equation"
    ) {
      const text = shortText(p.text ?? p.content ?? p.latex, 40);
      if (!text) continue;
      ensureRoom(95);
      const size = Math.max(26, Math.min(36, num(p.size, text.length < 16 ? 34 : 28)));
      out.push({
        time: out.length * 280,
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
      y += Math.max(88, size + 52);
      continue;
    }

    if (action === "underline" || action === "highlight") {
      // Convert heavy highlights into a thin underline under the last text line.
      const underlineY = Math.max(130, y - 58);
      out.push({
        time: out.length * 280,
        action: "underline",
        parameters: {
          x1: input.rtl ? textX : textX,
          y1: underlineY,
          x2: input.rtl ? textX - 360 : textX + 360,
          y2: underlineY,
          color: action === "highlight" ? "orange" : String(p.color || "orange"),
          width: 3.2,
        },
      });
      continue;
    }

    if (action === "draw_line") {
      ensureRoom(20);
      const ly = Math.min(980, diagramY);
      out.push({
        time: out.length * 280,
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
        time: out.length * 280,
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
      out.push({
        time: out.length * 280,
        action: "draw_circle",
        parameters: {
          cx: diagramX + 40,
          cy,
          r,
          color: String(p.color || "red"),
          width: 3.2,
        },
      });
      diagramY += r * 2 + 50;
      continue;
    }

    if (action === "draw_rectangle" || action === "draw_rect") {
      const ry = Math.min(860, diagramY);
      out.push({
        time: out.length * 280,
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
