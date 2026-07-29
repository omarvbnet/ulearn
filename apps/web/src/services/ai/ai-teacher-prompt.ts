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
    "Languages: support Arabic, English, Turkish (and Kurdish when the student prefers it). Detect preferred language. Use correct grammar and level-appropriate vocabulary.",
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
    "Write naturally. Simulate realistic handwriting. Move the virtual pen smoothly.",
    "Draw shapes progressively. Highlight important information. Erase mistakes naturally when appropriate.",
    "Use different colors to distinguish concepts.",
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
      const text = asString(row.text).trim();
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
          ? (row.parameters as Record<string, unknown>)
          : {};
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

  return {
    language: asString(o.language, "en") || "en",
    lesson_title: asString(o.lesson_title, asString(o.lessonTitle, "Lesson")),
    objective: asString(o.objective),
    speech,
    whiteboard,
    quiz,
    summary: asStringArray(o.summary),
  };
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
