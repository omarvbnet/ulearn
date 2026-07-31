import { normalizeBoardActions } from "@/services/ai/classroom/board-layout";
import type { BoardInstruction, ClassroomBoardAction, SpeechLang } from "../types";

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
          const text = String(ins.text || "").trim().slice(0, 28);
          if (!text) break;
          labels.push(text);
          raw.push({
            time: t,
            action: "write_text",
            parameters: { text, color, size: 56 },
          });
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
    const label =
      topic.slice(0, 28) ||
      (speechLanguage === "ar"
        ? "فكرة الدرس"
        : speechLanguage === "tr"
          ? "Ders fikri"
          : "Key idea");
    return [
      {
        time: 0,
        action: "write_text",
        parameters: { text: label, color: "blue", size: 58 },
      },
      {
        time: 1,
        action: "draw_circle",
        parameters: { color: "red", r: 48 },
      },
      ...actions,
    ];
  }
}
