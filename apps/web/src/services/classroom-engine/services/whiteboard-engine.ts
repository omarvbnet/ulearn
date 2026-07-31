import { normalizeBoardActions } from "@/services/ai/classroom/board-layout";
import { isWeakLessonTitle } from "@/services/ai/material-topic";
import type { BoardInstruction, ClassroomBoardAction, SpeechLang } from "../types";

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺",
};

/** "2×10^-9" → "2×10⁻⁹" so formulas read like a real board, not source code. */
function prettifyMath(text: string): string {
  return text.replace(/\^\s*([+-]?\d{1,3})/g, (_, exp: string) =>
    exp.split("").map((ch) => SUPERSCRIPTS[ch] || ch).join("")
  );
}

/** Wrap at word boundaries into up to `maxLines` board lines — never "…". */
function wrapBoardText(text: string, maxChars = 32, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [text.slice(0, maxChars)];
}

/**
 * Whiteboard Engine — DeepSeek never draws.
 * It emits structured instructions; this engine executes them.
 */
export class WhiteboardEngine {
  static execute(
    instructions: BoardInstruction[],
    input: { speechLanguage: SpeechLang; cursorY: number }
  ): { actions: ClassroomBoardAction[]; nextCursorY: number; labels: string[] } {
    const rtl = input.speechLanguage === "ar";
    const raw: ClassroomBoardAction[] = [];
    let t = 0;
    const labels: string[] = [];

    for (const ins of instructions.slice(0, 6)) {
      const color = ins.color || "blue";
      switch (ins.op) {
        case "clear":
          raw.push({ time: t, action: "clear_board", parameters: {} });
          break;
        case "write": {
          const text = prettifyMath(String(ins.text || "").trim());
          if (!text) break;
          labels.push(text.slice(0, 48));
          for (const line of wrapBoardText(text)) {
            raw.push({
              time: t,
              action: "write_text",
              parameters: { text: line, color, size: 56 },
            });
            t += 1;
          }
          break;
        }
        case "draw_circle": {
          const n = Math.max(1, Math.min(3, ins.count || 1));
          for (let i = 0; i < n; i++) {
            raw.push({
              time: t + i,
              action: "draw_circle",
              parameters: { color: ins.color || "red", r: 48 },
            });
          }
          break;
        }
        case "draw_rectangle": {
          const n = Math.max(1, Math.min(3, ins.count || 1));
          for (let i = 0; i < n; i++) {
            raw.push({
              time: t + i,
              action: "draw_rectangle",
              parameters: { color: ins.color || "brown" },
            });
          }
          break;
        }
        case "draw_line":
          raw.push({
            time: t,
            action: "draw_line",
            parameters: { color },
          });
          break;
        case "draw_arrow":
        case "animate":
          raw.push({
            time: t,
            action: "draw_arrow",
            parameters: { color: ins.color || "green" },
          });
          break;
        case "circle":
        case "highlight":
          raw.push({
            time: t,
            action: "circle_highlight",
            parameters: { color: ins.color || "red" },
          });
          break;
        case "underline":
          raw.push({
            time: t,
            action: "underline",
            parameters: { color: ins.color || "orange" },
          });
          break;
        case "point":
          raw.push({
            time: t,
            action: "point_at",
            parameters: { color },
          });
          break;
        case "erase":
          raw.push({ time: t, action: "clear_board", parameters: {} });
          break;
        default:
          break;
      }
      t += 1;
    }

    const layout = normalizeBoardActions(raw, {
      rtl,
      cursorY: input.cursorY || 160,
    });
    return {
      actions: layout.actions,
      nextCursorY: layout.nextCursorY,
      labels,
    };
  }

  static ensureTeachingInk(
    actions: ClassroomBoardAction[],
    topic: string,
    speechLanguage: SpeechLang
  ): ClassroomBoardAction[] {
    const hasInk = actions.some((a) =>
      /write_text|draw_/i.test(String(a.action || ""))
    );
    if (hasInk) return actions;
    const neutral =
      speechLanguage === "ar"
        ? "فكرة الدرس"
        : speechLanguage === "tr"
          ? "Ders fikri"
          : "Key idea";
    // Never ink a cover-page teacher name or filename as the "topic".
    const safeTopic = topic && !isWeakLessonTitle(topic) ? topic : neutral;
    return [
      {
        time: 0,
        action: "write_text",
        parameters: { text: safeTopic.slice(0, 32), color: "blue", size: 58 },
      },
      ...actions,
    ];
  }
}
