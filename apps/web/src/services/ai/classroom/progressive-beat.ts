/**
 * Progressive parsing of a classroom beat JSON object as it streams in.
 *
 * The model emits one JSON object per beat. We do NOT wait for the closing
 * brace before the student hears/sees anything — as soon as a complete
 * speak string or board action object appears inside the still-growing
 * text, we surface it to the client.
 */

/** Brace-balanced top-level JSON object finder (string/escape aware). */
export function findBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function findKeyArrayStart(text: string, key: string): number {
  const re = new RegExp(`"${key}"\\s*:\\s*\\[`);
  const m = re.exec(text);
  if (!m) return -1;
  return m.index + m[0].length - 1; // index of '['
}

/** Extract complete JSON string literals from a (possibly truncated) array. */
function extractCompleteStringsFromArray(text: string, arrayOpenIdx: number): string[] {
  const out: string[] = [];
  let i = arrayOpenIdx + 1;
  let inString = false;
  let escape = false;
  let current = "";
  while (i < text.length) {
    const ch = text[i];
    if (!inString) {
      if (ch === "]") break;
      if (ch === '"') {
        inString = true;
        current = "";
        escape = false;
      }
      i++;
      continue;
    }
    if (escape) {
      current += ch;
      escape = false;
      i++;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      i++;
      continue;
    }
    if (ch === '"') {
      out.push(current);
      inString = false;
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  return out;
}

/** Extract complete `{...}` objects from a (possibly truncated) array. */
function extractCompleteObjectsFromArray(text: string, arrayOpenIdx: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let i = arrayOpenIdx + 1;
  while (i < text.length) {
    while (i < text.length && (text[i] === "," || /\s/.test(text[i]))) i++;
    if (i >= text.length || text[i] === "]") break;
    if (text[i] !== "{") {
      // Skip unexpected tokens until next object or end.
      i++;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escape = false;
    const start = i;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            out.push(JSON.parse(slice) as Record<string, unknown>);
          } catch {
            /* ignore incomplete/corrupt fragment */
          }
          i++;
          break;
        }
      }
    }
    if (depth !== 0) break; // truncated object — stop
  }
  return out;
}

function extractStringField(text: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = re.exec(text);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
}

export type ProgressiveBeatFields = {
  speak: string[];
  boardRaw: Record<string, unknown>[];
  emotion: string | null;
  pace: string | null;
  completeJson: string | null;
};

/** Pull whatever complete speak lines / board objects are already present. */
export function extractProgressiveBeatFields(text: string): ProgressiveBeatFields {
  const speakStart = findKeyArrayStart(text, "speak");
  const boardStart = findKeyArrayStart(text, "board");
  return {
    speak: speakStart >= 0 ? extractCompleteStringsFromArray(text, speakStart) : [],
    boardRaw: boardStart >= 0 ? extractCompleteObjectsFromArray(text, boardStart) : [],
    emotion: extractStringField(text, "emotion"),
    pace: extractStringField(text, "pace"),
    completeJson: findBalancedJsonObject(text),
  };
}

export type ClassroomStreamEvent =
  | { type: "status"; presence: string; message?: string }
  | { type: "session"; session: unknown }
  | { type: "speak"; index: number; text: string; emotion?: string | null; pace?: string | null }
  | { type: "board"; actions: unknown[] }
  | { type: "complete"; beat: unknown; session: unknown }
  | { type: "needs_materials"; materials: unknown[]; pendingQuestion: string }
  | { type: "error"; message: string };
