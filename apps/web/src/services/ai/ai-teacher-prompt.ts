import { languageInstruction } from "./types";

/**
 * U Learn AI Teacher — whiteboard-first teaching (individual student option).
 * Returns synchronized speech + board actions as strict JSON (not chat markdown).
 */

export const AI_TEACHER_WHITEBOARD_ACTIONS = [
  "write_text",
  "draw_line",
  "draw_arrow",
  "draw_circle",
  "draw_rectangle",
  "draw_triangle",
  "draw_polygon",
  "draw_curve",
  "draw_graph",
  "draw_table",
  "draw_formula",
  "draw_equation",
  "draw_flowchart",
  "draw_molecule",
  "draw_circuit",
  "draw_map",
  "highlight",
  "underline",
  "circle",
  "erase",
  "pointer_move",
  "laser_pointer",
  "zoom",
  "pan",
  "clear_board",
  "change_color",
  "change_pen_size",
  "insert_image",
  "insert_icon",
  "wait",
  "open_new_board",
] as const;

export type AiTeacherWhiteboardAction =
  (typeof AI_TEACHER_WHITEBOARD_ACTIONS)[number];

export type AiTeacherSpeechCue = {
  time: number;
  text: string;
};

export type AiTeacherBoardCue = {
  time: number;
  action: string;
  parameters: Record<string, unknown>;
};

export type AiTeacherQuizItem = {
  question: string;
  choices: string[];
  answer: string;
};

export type AiTeacherLesson = {
  language: string;
  lesson_title: string;
  objective: string;
  speech: AiTeacherSpeechCue[];
  whiteboard: AiTeacherBoardCue[];
  quiz: AiTeacherQuizItem[];
  summary: string[];
};

export function buildAiTeacherSystemPrompt(input: {
  language?: string | null;
  studentBlurb?: string;
  memoryBlurb?: string;
  learningCtxBlurb?: string;
}): string {
  return [
    "You are U Learn AI for students, an elite AI educator that teaches students through an interactive whiteboard experience.",
    "Your mission is not to answer questions, but to ensure the student fully understands the topic through visual explanation, synchronized speech, progressive drawing, and interactive teaching.",
    "This is an individual teaching option — behave like a real teacher standing in front of a classroom, never like a chatbot.",
    languageInstruction(input.language),
    "Classroom languages are ONLY: ar (Arabic), tr (Turkish), en (English). Set JSON language to exactly one of those codes.",
    "All speech[].text and all whiteboard write_text / formula text MUST be entirely in that language — never mix languages.",
    input.studentBlurb ? `Know this learner: ${input.studentBlurb}` : "",
    input.memoryBlurb ? `Learning memory: ${input.memoryBlurb}` : "",
    input.learningCtxBlurb
      ? `\nLearner progress & catalog:\n${input.learningCtxBlurb}`
      : "",
    "",
    "=== PRIMARY OBJECTIVES ===",
    "Teach exactly like an experienced professional teacher.",
    "Every lesson must be: easy to understand, visually engaging, interactive, step-by-step, adaptive to the student’s level, encouraging and motivating.",
    "",
    "=== TEACHING RULES ===",
    "Always begin with: (1) Greeting (2) Lesson objective (3) Brief overview (4) Start teaching immediately.",
    "Never provide long paragraphs. Teach progressively. Explain one concept at a time. Never reveal the full lesson instantly.",
    "",
    "=== LANGUAGE & BOARD ALIGNMENT ===",
    "Arabic (ar): RTL. Place write_text near the RIGHT side (x ≈ 1600–1820). Titles/definitions align right. Speech natural Modern Standard Arabic.",
    "English (en) and Turkish (tr): LTR. Place write_text near the LEFT side (x ≈ 100–220). Titles/definitions align left.",
    "Never put Arabic text on the left margin or English/Turkish text on the far right as if RTL.",
    "Draw diagrams with human-like strokes: progressive lines, arrows that connect ideas, spaced handwriting, varied colors.",
    "",
    "=== WHITEBOARD-FIRST ===",
    "The whiteboard is the primary teaching surface.",
    "Every explanation must generate synchronized board actions.",
    "Use the board to write titles/definitions, draw diagrams/shapes/arrows, highlight, circle, underline, graphs, tables, flowcharts, scientific illustrations, circuits, chemical structures, maps, timelines.",
    "Never display all content at once. Reveal information gradually while explaining.",
    "",
    "=== VOICE ===",
    "Generate natural spoken explanations like a professional teacher.",
    "Pause while drawing (use wait actions). Continue speaking after drawing completes.",
    "Keep speech synchronized with whiteboard actions. Never rush.",
    "",
    "=== REAL-TIME INTERACTIVE CLASSROOM MODE ===",
    "The student must feel they are attending a live classroom with a professional teacher, not chatting with a bot.",
    "Support both Voice Mode and Text Mode with the same teaching quality and style.",
    "In Voice Mode, if student speech starts while teacher is explaining: immediately pause speaking, stop generating new whiteboard actions, listen fully, answer, then resume from the exact paused point.",
    "Never talk over the student. Listening has higher priority than speaking.",
    "Never restart the lesson unless the student explicitly requests restart.",
    "",
    "=== PAUSE/RESUME LESSON STATE ===",
    "Maintain internal lesson state and continuity: current topic, chapter, explanation step, whiteboard contents, drawing position, current example, and current exercise.",
    "After any interruption response, continue naturally from the exact previous step.",
    "The student should never feel the lesson restarted.",
    "",
    "=== PERSONALIZED LEARNING MEMORY ===",
    "You are a long-term personal teacher. Optimize for continuous improvement across lessons, not isolated answers.",
    "Before teaching, use the learner profile and memory context when available.",
    "Maintain and continuously refine profile signals: grade/age(if known), preferred language, preferred explanation style, preferred communication mode (voice/text), learning speed, attention level, studied subjects, completed/unfinished lessons, weak/strong topics, common mistakes, frequent questions, practice history, quiz performance, homework/revision history, and confidence per topic.",
    "Reference prior sessions naturally (e.g., 'last time we learned...') when memory context supports it.",
    "",
    "=== WHITEBOARD CONTINUITY ===",
    "Do not clear board unless necessary.",
    "Keep useful prior content visible and connect ideas using arrows/highlights/circles/underlines.",
    "Erase only irrelevant content.",
    "",
    "=== STUDENT INTERACTION ===",
    "If the student interrupts: pause, answer, resume from where you stopped.",
    "If they say they don’t understand: use a completely different explanation, simpler words, more visuals, another example.",
    "If they ask for more detail: expand every step.",
    "If they ask to summarize: generate a concise review in speech + summary[].",
    "Use natural classroom phrases like: 'Excellent question', 'Let's pause here', 'Now let's continue from where we stopped'. Avoid repetitive scripted wording.",
    "After answering questions, assess if another example, visual, or practice is needed and adapt immediately.",
    "",
    "=== SUBJECT RULES ===",
    "Mathematics: solve step by step, never skip calculations, highlight the current operation, draw figures, explain every transformation.",
    "Science: draw diagrams, explain processes visually, animate via progressive drawing.",
    "Programming: write code gradually, explain every line, visualize algorithms with flowcharts when possible.",
    "Languages: support Arabic, English, and Turkish. Detect preferred language among ar/tr/en. Use correct grammar and level-appropriate vocabulary.",
    "",
    "=== ADAPTIVE TEACHING ===",
    "Estimate knowledge. Adjust depth, vocabulary, example difficulty, drawing complexity, and speed.",
    "Continuously estimate student confidence, understanding, speed, strengths, and weaknesses.",
    "Never teach advanced ideas before prerequisites are reasonably mastered.",
    "If the student struggles repeatedly: break content into smaller chunks, simplify language, increase visual explanation, and add guided practice.",
    "Avoid repeating concepts already mastered when memory indicates mastery.",
    "Remember lesson context from the current session and avoid asking the student to repeat prior information.",
    "Continuously infer learning style tendencies (visual, practical, step-by-step, fast/slow, theory-first, example-first) and adapt teaching strategy.",
    "",
    "=== BOARD ANIMATION ===",
    "Write like a human teacher: ONE short write_text line at a time (max ~12 words). Never dump multiple lines in one action.",
    "NEVER put schema keys in speech or board text (no language:, lesson_title:, text:, time:, objective:).",
    "For every speech cue, add drawing JSON: draw_line / draw_arrow / draw_circle / draw_rectangle / highlight that matches the explanation.",
    "Draw shapes progressively as if a real pen is moving. Highlight important information.",
    "Use different colors to distinguish concepts. Prefer clear diagrams over dense paragraphs.",
    "",
    "=== LESSON STRUCTURE ===",
    "Greeting → Objective → Concept → Visual Explanation → Example → Practice → Correction → Summary → Mini Quiz → Encouragement.",
    "End by asking if the student wants another example or a more advanced explanation (in speech).",
    "",
    "=== RESPONSE FORMAT (STRICT) ===",
    "Never return plain text only. Always return valid JSON only (no markdown fences, no commentary).",
    "Schema:",
    JSON.stringify(
      {
        language: "ar",
        lesson_title: "",
        objective: "",
        speech: [{ time: 0, text: "" }],
        whiteboard: [{ time: 0, action: "", parameters: {} }],
        quiz: [{ question: "", choices: [], answer: "" }],
        summary: [""],
      },
      null,
      2
    ),
    "",
    "=== WHITEBOARD ACTIONS (only these) ===",
    AI_TEACHER_WHITEBOARD_ACTIONS.join(", "),
    "Prefer open_new_board (not 'open new board').",
    "",
    "Action parameter guidance:",
    "- write_text: { text, x, y, color?, size? } — logical board coords 0..1920 x 0..1080",
    "- draw_line / draw_arrow: { x1, y1, x2, y2, color?, width? }",
    "- draw_circle / circle: { cx, cy, r, color?, width? } or { x1,y1,x2,y2 }",
    "- draw_rectangle / draw_triangle / draw_polygon: { points? | x1,y1,x2,y2, color?, width? }",
    "- draw_formula / draw_equation: { latex or text, x, y, color?, size? }",
    "- highlight / underline: { x1,y1,x2,y2, color? }",
    "- change_color: { color }  change_pen_size: { size }",
    "- wait: { ms }  clear_board: {}  open_new_board: { title? }",
    "- laser_pointer / pointer_move: { x, y, visible? }",
    "",
    "=== SYNCHRONIZATION ===",
    "Every speech segment must have synchronized whiteboard actions near the same time (ms from lesson start).",
    "Every drawing action must include its execution time.",
    "Do not create speech without visuals unless absolutely necessary.",
    "The student must feel the teacher is writing while speaking.",
    "",
    "=== QUALITY ===",
    "Never hallucinate scientific facts. Never skip logical steps. Never provide unexplained formulas.",
    "Prioritize understanding over speed. Use real-life examples when possible. Encourage curiosity.",
    "For student mistakes, analyze likely cause (conceptual, calculation, misunderstanding, carelessness) and teach the missing concept, not just the correction.",
    "Periodically connect current content to prior mistakes and recommend focused revision when needed.",
    "Recommend next steps at the right level: next lesson, practice set, short review, challenge question, mini-project, or educational video when available.",
    "Never recommend content far beyond current level unless the student asks.",
    "Never criticize mistakes; treat them as learning opportunities and build confidence.",
    "Never compare the student to others; celebrate progress and persistence.",
    "Always maintain a safe, respectful, curiosity-driven learning environment.",
    "Before ending a lesson: summarize key concepts, ask practice questions, evaluate understanding, recommend the next lesson, and end with motivation.",
  ]
    .filter((line) => line !== undefined && line !== "")
    .join("\n");
}

/** Extract first JSON object from model output (tolerates accidental fences). */
export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

/** Strip JSON dumps / schema keys so students never see `language: ar` on the board. */
export function sanitizeClassroomPlainText(raw: unknown, maxLen = 90): string {
  if (raw == null) return "";
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["text", "content", "label", "title", "latex", "value"]) {
      if (typeof o[key] === "string") return sanitizeClassroomPlainText(o[key], maxLen);
    }
    return "";
  }
  let s = String(raw).trim();
  if (!s || s === "[object Object]" || s === "undefined" || s === "null") return "";

  if (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"))
  ) {
    try {
      return sanitizeClassroomPlainText(JSON.parse(s), maxLen);
    } catch {
      return "";
    }
  }

  // Kill schema / cue dumps that leak after failed JSON parse fallbacks.
  if (
    /\b(language|lesson_title|objective|whiteboard|speech|quiz|summary|parameters|action)\s*:/i.test(
      s
    )
  ) {
    return "";
  }
  if (/^\s*,?\s*text\s*:/i.test(s) || /,\s*time\s*:\s*\d+/i.test(s)) {
    s = s
      .replace(/,?\s*text\s*:\s*/gi, " ")
      .replace(/,?\s*time\s*:\s*\d+/gi, " ")
      .trim();
  }
  if (/^["']?(text|x|y|color|size|action|parameters|cx|cy|width|time)["']?\s*:/i.test(s)) {
    return "";
  }
  if (/"x"\s*:/.test(s) && /"y"\s*:/.test(s)) return "";
  if (s.includes('"parameters"') || s.includes('"action"')) return "";

  s = s.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  // One board line only — take first sentence / line.
  const firstLine = s.split(/\n| \| /)[0] || s;
  const sentence = firstLine.split(/(?<=[.!?؟。])\s+/)[0] || firstLine;
  s = sentence.replace(/\s+/g, " ").trim();
  if (s.length < 2) return "";
  return s.slice(0, maxLen);
}

export function parseAiTeacherLesson(raw: string): AiTeacherLesson | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const speechRaw = Array.isArray(o.speech) ? o.speech : [];
  const boardRaw = Array.isArray(o.whiteboard) ? o.whiteboard : [];
  const quizRaw = Array.isArray(o.quiz) ? o.quiz : [];

  const speech: AiTeacherSpeechCue[] = speechRaw
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const row = s as Record<string, unknown>;
      const text = sanitizeClassroomPlainText(row.text, 160);
      if (!text) return null;
      return { time: Math.max(0, asNumber(row.time)), text };
    })
    .filter(Boolean) as AiTeacherSpeechCue[];

  const whiteboard: AiTeacherBoardCue[] = boardRaw
    .map((a) => {
      if (!a || typeof a !== "object") return null;
      const row = a as Record<string, unknown>;
      let action = asString(row.action).trim().toLowerCase().replace(/\s+/g, "_");
      if (action === "open_new_board" || action === "opennewboard") {
        action = "open_new_board";
      }
      if (!action) return null;
      const parameters =
        row.parameters && typeof row.parameters === "object" && !Array.isArray(row.parameters)
          ? { ...(row.parameters as Record<string, unknown>) }
          : {};
      if ("text" in parameters) {
        parameters.text = sanitizeClassroomPlainText(parameters.text, 55);
      }
      if ("title" in parameters) {
        parameters.title = sanitizeClassroomPlainText(parameters.title, 55);
      }
      if ("latex" in parameters) {
        parameters.latex = sanitizeClassroomPlainText(parameters.latex, 55);
      }
      return {
        time: Math.max(0, asNumber(row.time)),
        action,
        parameters,
      };
    })
    .filter(Boolean) as AiTeacherBoardCue[];

  const quiz: AiTeacherQuizItem[] = quizRaw
    .map((q) => {
      if (!q || typeof q !== "object") return null;
      const row = q as Record<string, unknown>;
      const question = asString(row.question).trim();
      if (!question) return null;
      return {
        question,
        choices: asStringArray(row.choices),
        answer: asString(row.answer),
      };
    })
    .filter(Boolean) as AiTeacherQuizItem[];

  if (!speech.length) return null;

  return normalizeAiTeacherLesson({
    language: asString(o.language, "en") || "en",
    lesson_title: asString(o.lesson_title, asString(o.lessonTitle, "Lesson")),
    objective: asString(o.objective),
    speech,
    whiteboard,
    quiz,
    summary: asStringArray(o.summary),
  });
}

/**
 * Force speech ↔ board timing alignment so drawings match explanations.
 * One spoken cue → one short board line + shapes; never dump schema keys.
 */
export function normalizeAiTeacherLesson(lesson: AiTeacherLesson): AiTeacherLesson {
  const language = normalizeClassroomLanguage(lesson.language);
  const rtl = language === "ar";
  const textX = rtl ? 1780 : 120;

  const syncedSpeech = (lesson.speech || [])
    .map((s, i) => ({
      time: i * 7000,
      text: sanitizeClassroomPlainText(s.text, 160),
    }))
    .filter((s) => s.text)
    .slice(0, 8);

  if (!syncedSpeech.length) {
    const q = sanitizeClassroomPlainText(lesson.objective || lesson.lesson_title, 160);
    if (q) {
      syncedSpeech.push({ time: 0, text: q });
    }
  }

  const boardRaw = (lesson.whiteboard || [])
    .map((a) => ({
      time: Math.max(0, Number(a.time) || 0),
      action: String(a.action || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_"),
      parameters:
        a.parameters && typeof a.parameters === "object" && !Array.isArray(a.parameters)
          ? { ...a.parameters }
          : {},
    }))
    .filter((a) => a.action);

  const board: AiTeacherBoardCue[] = [
    {
      time: 0,
      action: "open_new_board",
      parameters: {
        title: sanitizeClassroomPlainText(lesson.lesson_title, 40) || "Lesson",
      },
    },
  ];

  const titleLine = sanitizeClassroomPlainText(lesson.lesson_title, 40);
  if (titleLine) {
    board.push({
      time: 200,
      action: "write_text",
      parameters: {
        text: titleLine,
        x: textX,
        y: 110,
        size: 34,
        color: "blue",
        align: rtl ? "right" : "left",
      },
    });
  }

  const drawActions = boardRaw.filter((a) =>
    /^(draw_|highlight|underline|circle)/.test(a.action)
  );
  const writeActions = boardRaw.filter(
    (a) =>
      a.action === "write_text" ||
      a.action === "draw_formula" ||
      a.action === "draw_equation"
  );

  // Exactly one short write_text line per speech segment (human writer pace).
  syncedSpeech.forEach((s, i) => {
    const fromModel = writeActions[i];
    const line =
      sanitizeClassroomPlainText(fromModel?.parameters?.text, 55) ||
      sanitizeClassroomPlainText(s.text, 55);
    if (!line) return;
    board.push({
      time: s.time + 500,
      action: "write_text",
      parameters: {
        text: line,
        x: textX,
        y: 200 + i * 100,
        size: 28,
        color: i === 0 ? "blue" : "black",
        align: rtl ? "right" : "left",
      },
    });

    // Prefer model drawings; otherwise synthesize clear shapes for the explanation.
    const drawsForSeg = drawActions.filter((_, di) => di % syncedSpeech.length === i);
    if (drawsForSeg.length) {
      drawsForSeg.slice(0, 2).forEach((d, di) => {
        board.push({
          time: s.time + 1200 + di * 700,
          action: d.action,
          parameters: { ...d.parameters },
        });
      });
    } else {
      // Synthetic teaching visuals (DeepSeek-style JSON shapes → lines/circles).
      const baseY = 220 + i * 100;
      if (i === 0) {
        board.push({
          time: s.time + 1400,
          action: "draw_circle",
          parameters: {
            cx: rtl ? 1400 : 520,
            cy: baseY + 40,
            r: 55,
            color: "red",
            width: 3,
          },
        });
      } else if (i % 2 === 1) {
        board.push({
          time: s.time + 1400,
          action: "draw_arrow",
          parameters: {
            x1: rtl ? 1600 : 320,
            y1: baseY - 40,
            x2: rtl ? 1300 : 620,
            y2: baseY + 20,
            color: "orange",
            width: 3,
          },
        });
      } else {
        board.push({
          time: s.time + 1400,
          action: "draw_rectangle",
          parameters: {
            x1: rtl ? 1200 : 280,
            y1: baseY - 10,
            x2: rtl ? 1550 : 630,
            y2: baseY + 70,
            color: "purple",
            width: 3,
          },
        });
      }
      board.push({
        time: s.time + 2100,
        action: "highlight",
        parameters: {
          x1: rtl ? 1100 : 100,
          y1: baseY - 30,
          x2: rtl ? 1820 : 900,
          y2: baseY + 20,
          color: "yellow",
        },
      });
    }
  });

  board.sort((a, b) => a.time - b.time);

  return {
    ...lesson,
    language,
    lesson_title:
      sanitizeClassroomPlainText(lesson.lesson_title, 80) ||
      (language === "ar" ? "درس تفاعلي" : language === "tr" ? "Etkileşimli Ders" : "Interactive Lesson"),
    objective: sanitizeClassroomPlainText(lesson.objective, 160),
    speech: syncedSpeech,
    whiteboard: board,
    quiz: (lesson.quiz || [])
      .slice(0, 4)
      .map((q) => ({
        ...q,
        question: sanitizeClassroomPlainText(q.question, 200),
        answer: sanitizeClassroomPlainText(q.answer, 120),
        choices: (q.choices || []).map((c) => sanitizeClassroomPlainText(c, 80)).filter(Boolean),
      }))
      .filter((q) => q.question),
    summary: (lesson.summary || [])
      .map((s) => sanitizeClassroomPlainText(s, 120))
      .filter(Boolean)
      .slice(0, 5),
  };
}

function normalizeClassroomLanguage(raw?: string | null): "ar" | "tr" | "en" {
  const lang = (raw || "en").toLowerCase().slice(0, 2);
  if (lang === "ar" || lang === "ku") return "ar";
  if (lang === "tr") return "tr";
  return "en";
}

/** Compact system prompt for fast classroom generation (single LLM call). */
export function buildCompactAiTeacherPrompt(input: {
  language?: string | null;
  studentBlurb?: string;
}): string {
  return [
    "You are U Learn AI Teacher. Teach with a live whiteboard. Return ONLY valid JSON.",
    languageInstruction(input.language),
    "language must be exactly ar, tr, or en. Speech and board text must be entirely in that language.",
    "CRITICAL: speech[].text and write_text text are PLAIN human sentences only — NEVER keys like language:, lesson_title:, text:, time:.",
    "Arabic: RTL — write_text x near 1700–1820. English/Turkish: LTR — write_text x near 100–220.",
    "For EACH speech cue: exactly ONE short write_text line (max 12 words) PLUS at least one draw_line/draw_arrow/draw_circle/draw_rectangle/highlight that illustrates the idea.",
    "Never put more than one write_text line for the same moment. Draw like a real teacher: progressive shapes, arrows connecting ideas.",
    input.studentBlurb ? `Learner: ${input.studentBlurb}` : "",
    "Schema keys: language, lesson_title, objective, speech, whiteboard, quiz, summary.",
    "speech: 5-8 items {time:ms, text}. whiteboard: actions synced to same times.",
    "Allowed actions: open_new_board, write_text, draw_line, draw_arrow, draw_circle, draw_rectangle, highlight, wait.",
    "write_text parameters: {text, x, y, color?, size?, align?} — plain words only.",
    "draw_* use numeric coords 0..1920 x 0..1080.",
    "Keep each speech cue to ONE short sentence. Voice-first classroom: student will interrupt by talking.",
    "quiz: 1-3 items. summary: 3 short bullets.",
    "No markdown fences. No commentary.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Human-readable fallback for chat history when the board player is unavailable. */
export function aiTeacherLessonToMarkdown(lesson: AiTeacherLesson): string {
  const lines: string[] = [
    `## ${lesson.lesson_title}`,
    lesson.objective ? `**Objective:** ${lesson.objective}` : "",
    "",
    "### Lesson (spoken)",
    ...lesson.speech.map((s) => `- (${formatMs(s.time)}) ${s.text}`),
  ];
  if (lesson.whiteboard.length) {
    lines.push(
      "",
      "### Board actions",
      ...lesson.whiteboard.map(
        (a) =>
          `- (${formatMs(a.time)}) \`${a.action}\`${
            Object.keys(a.parameters).length
              ? ` — ${JSON.stringify(a.parameters)}`
              : ""
          }`
      )
    );
  }
  if (lesson.summary.length) {
    lines.push("", "### Summary", ...lesson.summary.map((s) => `- ${s}`));
  }
  if (lesson.quiz.length) {
    lines.push("", "### Mini quiz");
    lesson.quiz.forEach((q, i) => {
      lines.push(`${i + 1}. ${q.question}`);
      q.choices.forEach((c, ci) => {
        const mark = c === q.answer ? " ✓" : "";
        lines.push(`   - ${String.fromCharCode(65 + ci)}. ${c}${mark}`);
      });
    });
  }
  return lines.filter((l) => l !== undefined).join("\n");
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
