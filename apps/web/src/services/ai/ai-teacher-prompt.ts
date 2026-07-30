import { accentInstruction } from "./voice-accent";

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
  /** Selected KB documents grounding this classroom */
  documentIds?: string[];
  /** Ordered lesson/chapter titles from first → last */
  curriculumOutline?: string[];
  /** Human material file names */
  materialNames?: string[];
};

export function buildAiTeacherSystemPrompt(input: {
  language?: string | null;
  countryCode?: string | null;
  studentBlurb?: string;
  memoryBlurb?: string;
  learningCtxBlurb?: string;
}): string {
  return [
    "You are U Learn AI for students, an elite AI educator that teaches students through an interactive whiteboard experience.",
    "Your mission is not to answer questions, but to ensure the student fully understands the topic through visual explanation, synchronized speech, progressive drawing, and interactive teaching.",
    "This is an individual teaching option — behave like a real teacher standing in front of a classroom, never like a chatbot.",
    accentInstruction(input.language, input.countryCode),
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
 * One spoken cue → one short board note + one diagram beat; never dump schema keys.
 */
export function normalizeAiTeacherLesson(lesson: AiTeacherLesson): AiTeacherLesson {
  const language = normalizeClassroomLanguage(lesson.language);
  const rtl = language === "ar";
  const textX = rtl ? 1780 : 120;
  const diagramX = rtl ? 420 : 1480;

  const syncedSpeech = (lesson.speech || [])
    .map((s, i) => ({
      time: i * 7500,
      text: sanitizeClassroomPlainText(s.text, 140),
    }))
    .filter((s) => s.text && !isMetaTeachingLine(s.text))
    .slice(0, 14);

  if (!syncedSpeech.length) {
    const q = sanitizeClassroomPlainText(lesson.objective || lesson.lesson_title, 140);
    if (q) syncedSpeech.push({ time: 0, text: q });
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
    .filter((a) => a.action && a.action !== "open_new_board");

  const titleLine =
    sanitizeClassroomPlainText(lesson.lesson_title, 36) ||
    (language === "ar" ? "درس اليوم" : language === "tr" ? "Bugünün dersi" : "Today's lesson");

  const board: AiTeacherBoardCue[] = [
    { time: 0, action: "open_new_board", parameters: { title: titleLine } },
    {
      time: 250,
      action: "write_text",
      parameters: {
        text: titleLine,
        x: textX,
        y: 100,
        size: 36,
        color: "blue",
        align: rtl ? "right" : "left",
      },
    },
  ];

  const drawActions = boardRaw.filter((a) =>
    /^(draw_|highlight|underline|circle)/.test(a.action)
  );
  const writeActions = boardRaw.filter(
    (a) =>
      a.action === "write_text" ||
      a.action === "draw_formula" ||
      a.action === "draw_equation"
  );

  syncedSpeech.forEach((s, i) => {
    const fromModel = writeActions[i];
    const modelNote = sanitizeClassroomPlainText(fromModel?.parameters?.text, 42);
    const line =
      (modelNote && modelNote !== titleLine ? modelNote : "") ||
      shortBoardNote(s.text, 42);
    if (!line || line === titleLine) {
      // still draw diagram for this beat
    } else {
      board.push({
        time: s.time + 450,
        action: "write_text",
        parameters: {
          text: line,
          x: textX,
          y: 190 + i * 95,
          size: 26,
          color: "black",
          align: rtl ? "right" : "left",
        },
      });
    }

    const drawsForSeg = drawActions.filter((_, di) => di % Math.max(1, syncedSpeech.length) === i);
    if (drawsForSeg.length) {
      drawsForSeg.slice(0, 2).forEach((d, di) => {
        board.push({
          time: s.time + 1100 + di * 650,
          action: d.action,
          parameters: { ...d.parameters },
        });
      });
    } else {
      board.push(...synthesizeTeachingDiagram({ index: i, time: s.time, rtl, diagramX, language }));
    }
  });

  board.sort((a, b) => a.time - b.time);

  return {
    ...lesson,
    language,
    lesson_title: titleLine,
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

function isMetaTeachingLine(text: string): boolean {
  return /سأكتب على السبورة|سطراً واحداً|one board line|only one line|tahtaya her seferinde|watch the drawings while|راقب الرسم بينما/i.test(
    text
  );
}

function shortBoardNote(speech: string, maxLen = 42): string {
  const clean = sanitizeClassroomPlainText(speech, 120);
  if (!clean) return "";
  const words = clean.split(/\s+/).filter(Boolean);
  const clipped = words.slice(0, 8).join(" ");
  return clipped.length > maxLen ? clipped.slice(0, maxLen - 1).trim() + "…" : clipped;
}

function synthesizeTeachingDiagram(input: {
  index: number;
  time: number;
  rtl: boolean;
  diagramX: number;
  language: string;
}): AiTeacherBoardCue[] {
  const { index: i, time, rtl, diagramX } = input;
  const cy = 260 + (i % 5) * 110;
  const cues: AiTeacherBoardCue[] = [];
  // Progressive concept map on the diagram side — not stacked yellow bars.
  if (i === 0) {
    cues.push({
      time: time + 1200,
      action: "draw_circle",
      parameters: { cx: diagramX, cy, r: 70, color: "blue", width: 4 },
    });
  } else if (i === 1) {
    cues.push({
      time: time + 1200,
      action: "draw_arrow",
      parameters: {
        x1: diagramX,
        y1: cy - 90,
        x2: diagramX + (rtl ? -90 : 90),
        y2: cy + 10,
        color: "orange",
        width: 4,
      },
    });
    cues.push({
      time: time + 1800,
      action: "draw_rectangle",
      parameters: {
        x1: diagramX + (rtl ? -200 : 40),
        y1: cy - 20,
        x2: diagramX + (rtl ? -40 : 200),
        y2: cy + 70,
        color: "purple",
        width: 3,
      },
    });
  } else if (i === 2) {
    cues.push({
      time: time + 1200,
      action: "draw_circle",
      parameters: { cx: diagramX - (rtl ? -120 : 120), cy, r: 45, color: "red", width: 3 },
    });
    cues.push({
      time: time + 1700,
      action: "draw_circle",
      parameters: { cx: diagramX + (rtl ? -120 : 120), cy, r: 45, color: "green", width: 3 },
    });
    cues.push({
      time: time + 2200,
      action: "draw_line",
      parameters: {
        x1: diagramX - (rtl ? -120 : 120) + 45,
        y1: cy,
        x2: diagramX + (rtl ? -120 : 120) - 45,
        y2: cy,
        color: "orange",
        width: 3,
      },
    });
  } else if (i === 3) {
    cues.push({
      time: time + 1200,
      action: "draw_arrow",
      parameters: {
        x1: diagramX - 80,
        y1: cy - 40,
        x2: diagramX + 100,
        y2: cy + 50,
        color: "red",
        width: 4,
      },
    });
  } else {
    cues.push({
      time: time + 1200,
      action: "draw_rectangle",
      parameters: {
        x1: diagramX - 110,
        y1: cy - 50,
        x2: diagramX + 110,
        y2: cy + 50,
        color: "blue",
        width: 3,
      },
    });
    cues.push({
      time: time + 1800,
      action: "underline",
      parameters: {
        x1: diagramX - 90,
        y1: cy + 60,
        x2: diagramX + 90,
        y2: cy + 60,
        color: "green",
      },
    });
  }
  return cues;
}

/**
 * Rich topic lesson when the model JSON fails — teaches the subject, not the UI.
 */
export function buildAiTeacherFallbackLesson(input: {
  language?: string | null;
  question: string;
}): AiTeacherLesson {
  const language = normalizeClassroomLanguage(input.language);
  const topicRaw = sanitizeClassroomPlainText(input.question, 100);
  const vague = isVagueTopicRequest(topicRaw);

  if (language === "ar") {
    const title = vague ? "الكهرباء الساكنة" : topicRaw.slice(0, 40) || "درس اليوم";
    const steps = vague
      ? [
          { speak: "مرحباً! اليوم سنتعلم الكهرباء الساكنة معاً.", board: "الكهرباء الساكنة" },
          { speak: "هي تجمع شحنات كهربائية على سطح الأجسام.", board: "تجمّع الشحنات" },
          { speak: "مثال: عندما ندلك مشطاً بالشعر يصبح مشحوناً.", board: "مشط + شعر" },
          { speak: "المشط المشحون يجذب قصاصات الورق الخفيفة.", board: "يجذب الورق" },
          { speak: "إذن الشحنات تنتقل بالاحتكاك. هل صار واضحاً؟", board: "الاحتكاك ← شحن" },
        ]
      : [
          { speak: `مرحباً! لنشرح ${title} خطوة بخطوة.`, board: title },
          { speak: `أولاً: نعرّف فكرة ${title} ببساطة.`, board: "التعريف" },
          { speak: "ثانياً: انظر إلى الرسم على السبورة.", board: "الرسم يوضح الفكرة" },
          { speak: "ثالثاً: مثال من الحياة اليومية يربط الفكرة.", board: "مثال واقعي" },
          { speak: "أخيراً: راجع النقطة الأهم، ثم اسألني بصوتك.", board: "الخلاصة" },
        ];
    return normalizeAiTeacherLesson({
      language: "ar",
      lesson_title: title,
      objective: vague ? "فهم ظاهرة الكهرباء الساكنة بأمثلة بسيطة" : `فهم ${title}`,
      speech: steps.map((s, i) => ({ time: i * 7500, text: s.speak })),
      whiteboard: steps.map((s, i) => ({
        time: i * 7500 + 500,
        action: "write_text",
        parameters: { text: s.board, x: 1780, y: 190 + i * 95, size: 26, color: "black", align: "right" },
      })),
      quiz: [
        {
          question: vague ? "ماذا يحدث عند دلك المشط بالشعر؟" : `ما الفكرة الأساسية في ${title}؟`,
          choices: vague
            ? ["يصبح مشحوناً", "يصبح أثقل", "يختفي", "يذوب"]
            : ["فكرة أساسية", "لا شيء", "عكس الفكرة", "رقم فقط"],
          answer: vague ? "يصبح مشحوناً" : "فكرة أساسية",
        },
      ],
      summary: vague
        ? ["الكهرباء الساكنة = تجمع شحنات", "الاحتكاك ينقل الشحنات", "المشط يجذب الورق"]
        : [title, "شرح خطوة بخطوة", "مثال واقعي"],
    });
  }

  if (language === "tr") {
    const title = vague ? "Statik elektrik" : topicRaw.slice(0, 40) || "Bugünün dersi";
    const steps = vague
      ? [
          { speak: "Merhaba! Bugün statik elektriği birlikte öğreneceğiz.", board: "Statik elektrik" },
          { speak: "Cisimlerin yüzeyinde yük birikmesidir.", board: "Yük birikmesi" },
          { speak: "Örnek: Tarağı saça sürtünce yüklü olur.", board: "Tarak + saç" },
          { speak: "Yüklü tarak hafif kâğıt parçalarını çeker.", board: "Kâğıdı çeker" },
          { speak: "Yani sürtünme yükleri taşır. Anladın mı?", board: "Sürtünme → yük" },
        ]
      : [
          { speak: `Merhaba! ${title} konusunu adım adım anlatalım.`, board: title },
          { speak: `Önce ${title} fikrini basitçe tanımlayalım.`, board: "Tanım" },
          { speak: "Sonra tahtadaki çizime bak.", board: "Çizim" },
          { speak: "Sonra günlük hayattan bir örnek verelim.", board: "Örnek" },
          { speak: "Son olarak ana fikri tekrarlayıp sesinle soru sor.", board: "Özet" },
        ];
    return normalizeAiTeacherLesson({
      language: "tr",
      lesson_title: title,
      objective: vague ? "Statik elektriği basit örneklerle anlamak" : `${title} konusunu anlamak`,
      speech: steps.map((s, i) => ({ time: i * 7500, text: s.speak })),
      whiteboard: steps.map((s, i) => ({
        time: i * 7500 + 500,
        action: "write_text",
        parameters: { text: s.board, x: 120, y: 190 + i * 95, size: 26, color: "black", align: "left" },
      })),
      quiz: [],
      summary: vague
        ? ["Statik elektrik = yük birikmesi", "Sürtünme yük taşır", "Tarak kâğıdı çeker"]
        : [title, "Adım adım anlatım", "Gerçek örnek"],
    });
  }

  const title = vague ? "Static electricity" : topicRaw.slice(0, 40) || "Today's lesson";
  const steps = vague
    ? [
        { speak: "Hi! Today we'll learn about static electricity together.", board: "Static electricity" },
        { speak: "It is electric charge gathered on a surface.", board: "Charge on surfaces" },
        { speak: "Example: rubbing a comb on hair charges the comb.", board: "Comb + hair" },
        { speak: "The charged comb attracts light paper bits.", board: "Attracts paper" },
        { speak: "So friction moves charge. Want to ask me anything?", board: "Friction → charge" },
      ]
    : [
        { speak: `Hi! Let's learn ${title} step by step.`, board: title },
        { speak: `First, a simple definition of ${title}.`, board: "Definition" },
        { speak: "Next, watch the diagram on the board.", board: "Diagram" },
        { speak: "Then a real-life example to connect the idea.", board: "Real example" },
        { speak: "Finally, the key takeaway — ask me by talking.", board: "Takeaway" },
      ];
  return normalizeAiTeacherLesson({
    language: "en",
    lesson_title: title,
    objective: vague ? "Understand static electricity with simple examples" : `Understand ${title}`,
    speech: steps.map((s, i) => ({ time: i * 7500, text: s.speak })),
    whiteboard: steps.map((s, i) => ({
      time: i * 7500 + 500,
      action: "write_text",
      parameters: { text: s.board, x: 120, y: 190 + i * 95, size: 26, color: "black", align: "left" },
    })),
    quiz: [],
    summary: vague
      ? ["Static electricity = charge buildup", "Friction moves charge", "Comb attracts paper"]
      : [title, "Step-by-step explanation", "Real-life example"],
  });
}

function isVagueTopicRequest(q: string): boolean {
  if (!q || q.length < 4) return true;
  return /موضوع اليوم|today'?s topic|bugünkü|خطوة بخطوة|step by step|علمني|teach me|öğret/i.test(q) &&
    !/(كهرب|electric|statik|photosynth|رياضيات|math|كيمياء|chem|فيزياء|physic|تاريخ|history)/i.test(q);
}

function normalizeClassroomLanguage(raw?: string | null): "ar" | "tr" | "en" {
  const lang = (raw || "en").toLowerCase().slice(0, 2);
  if (lang === "ar" || lang === "ku") return "ar";
  if (lang === "tr") return "tr";
  return "en";
}

/**
 * U Learn AI Teacher — Real Interactive Classroom (Version 2.0)
 * Shared persona for lesson generation + live interrupt replies.
 */
export function buildAiTeacherClassroomV2Persona(input: {
  language?: string | null;
  countryCode?: string | null;
}): string {
  return [
    "==================================================",
    "U Learn AI Teacher - Real Interactive Classroom",
    "Version 2.0",
    "==================================================",
    "You are NOT a chatbot. You are a professional AI Teacher in a LIVE interactive classroom.",
    "Mission: the student must feel a real teacher speaking, explaining, discussing, listening, drawing, and interacting.",
    accentInstruction(input.language, input.countryCode),
    "",
    "CORE BEHAVIOR:",
    "- Never feel like AI chat. Feel like sitting with a professional teacher.",
    "- Teach, explain, discuss, ask questions, listen carefully, interpret intentions, continue naturally, adapt, draw, encourage.",
    "- Never give one short answer and stop. Always keep an active educational conversation.",
    "",
    "VOICE INTERACTION:",
    "- Voice and text must have identical teaching quality.",
    "- If the student speaks: stop speaking, pause board progression, listen fully, understand intention,",
    "  detect confusion/curiosity/mistakes/interest, respond naturally, then continue the lesson smoothly.",
    "- Never talk over the student. Listening always has higher priority than speaking.",
    "",
    "CONTINUOUS TEACHING:",
    "- Do not explain one lesson and stop. Maintain continuity of lesson, topic, chapter, board, questions, level, mistakes.",
    "- After every interaction continue naturally with bridges like:",
    "  'Excellent question — this connects to what we were discussing.' / 'Let's return to the board.' /",
    "  'Now I will explain the next part.' / 'This concept connects with the previous lesson.'",
    "- Never restart the lesson unless the student asks.",
    "",
    "CONVERSATIONAL TEACHING:",
    "- Ask live classroom questions: 'Why do you think this happens?' 'What do you expect?'",
    "  'Can you solve this step?' 'Look carefully at the board.' 'Let's think together.'",
    "- Create real discussion. The classroom must feel alive.",
    "",
    "WHITEBOARD:",
    "- The board is the main teaching tool: write, draw, highlight, arrows, shapes, progressive reveal.",
    "- Never dump all content at once.",
    "",
    "MULTI-LANGUAGE:",
    "- Use the student's selected language for speech, board, quizzes, explanations, discussions.",
    "- Match regional teaching tone from country when helpful.",
    "",
    "INTELLIGENT INTERPRETATION:",
    "- Do not answer only literally. Understand intention.",
    "- 'I don't understand' => simpler explanation + visual examples + different style.",
    "- 'Can you repeat?' => slow down + simpler language + more examples.",
    "",
    "ACTIVE DISCUSSION:",
    "- Do not wait silently. Ask, challenge, encourage, give examples, connect concepts, keep engagement.",
    "",
    "LESSON STRUCTURE (each session should cover):",
    "1 Goal  2 Explanation  3 Whiteboard  4 Example  5 Student interaction  6 Practice",
    "7 Correction  8 Summary  9 Quiz  10 Bridge to next lesson",
    "",
    "FINAL OBJECTIVE:",
    "Student feeling: 'I am learning with a real teacher.'",
    "Classroom feeling: natural, interactive, professional, human, intelligent, visual, engaging.",
    "Never behave like a simple chatbot. Behave like a world-class live teacher.",
  ].join("\n");
}

/** Compact system prompt for fast classroom generation (single LLM call). */
export function buildCompactAiTeacherPrompt(input: {
  language?: string | null;
  countryCode?: string | null;
  studentBlurb?: string;
  curriculumOutline?: string[];
  materialNames?: string[];
}): string {
  const outline = (input.curriculumOutline || [])
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");
  const materials = (input.materialNames || []).filter(Boolean).join(", ");
  return [
    buildAiTeacherClassroomV2Persona({
      language: input.language,
      countryCode: input.countryCode,
    }),
    "",
    "OUTPUT RULES: Return ONLY valid JSON (no markdown).",
    "language must be exactly ar, tr, or en (ku maps board/speech locale to ar when needed).",
    "ALL speech[].text and write_text must be PLAIN human sentences — NEVER schema keys.",
    materials ? `Selected material(s): ${materials}` : "",
    outline
      ? `CURRICULUM ORDER (teach FIRST → LAST; announce each lesson name out loud):\n${outline}`
      : "If outline is missing, invent a clear progressive path and name each lesson step.",
    "TEACHING PATH:",
    "- Start at lesson 1, continue toward later lessons in order.",
    "- When starting each lesson, SAY and WRITE its exact name.",
    "- Inside the session include: goal → explain → board → example → ask the student a question →",
    "  practice/correction vibe → short summary → quiz → bridge to the next lesson.",
    "- Include at least 2 conversational questions in speech (invite thinking, not only lecture).",
    "- Cover listed lessons at least briefly; go deeper on early lessons if time-limited.",
    "BOARD CRAFT:",
    "Arabic RTL: write_text x ≈ 1700–1820. English/Turkish LTR: write_text x ≈ 100–220.",
    "Diagrams on the opposite side of text.",
    "For EACH speech cue: ONE short write_text (max 8 words) + 1–2 draw_* shapes for THAT idea.",
    "Progressive human drawings. Never stack highlight bars over text. Never spam the title every line.",
    input.studentBlurb ? `Learner: ${input.studentBlurb}` : "",
    "Schema: language, lesson_title, objective, speech, whiteboard, quiz, summary.",
    "lesson_title: course-style title for this live session (mention the material).",
    "speech: 10–14 items {time:ms, text: one short spoken sentence}. Mix explanations + discussion questions.",
    "whiteboard actions: open_new_board, write_text, draw_line, draw_arrow, draw_circle, draw_rectangle, underline, wait.",
    "write_text: {text,x,y,color?,size?,align?}. draw_*: coords 0..1920 x 0..1080.",
    "quiz: 1–2 items. summary: 3 short bullets + a next-lesson bridge idea.",
    "No commentary outside JSON.",
  ]
    .filter(Boolean)
    .join("\n");
}


export type ClassroomInterruptResult = {
  answer: string;
  board: AiTeacherBoardCue[];
};

/** Fast interrupt reply: spoken answer + board drawings for the student's question. */
export function buildClassroomInterruptPrompt(input: {
  language?: string | null;
  countryCode?: string | null;
  lessonTitle?: string;
  pausedIndex?: number;
  spokenSoFar?: string[];
  curriculumOutline?: string[];
  materialNames?: string[];
  materialExcerpt?: string;
}): string {
  const language = normalizeClassroomLanguage(input.language);
  const rtl = language === "ar";
  const outline = (input.curriculumOutline || [])
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");
  const materials = (input.materialNames || []).filter(Boolean).join(", ");
  return [
    buildAiTeacherClassroomV2Persona({
      language: input.language,
      countryCode: input.countryCode,
    }),
    "",
    "LIVE INTERRUPT NOW: the student just spoke / asked while class was running.",
    "Return ONLY valid JSON (no markdown): {\"answer\":\"...\",\"board\":[...]}",
    "answer: 3–6 short spoken sentences in the classroom language.",
    "ANSWER STRUCTURE (required):",
    "1) Acknowledge warmly and interpret intention (confusion / curiosity / mistake / request).",
    "2) Teach the needed idea clearly (not a one-line chatbot reply).",
    "3) If they asked about ANY lesson in selected materials, explain THAT lesson and say its name.",
    "4) Ask ONE short check / discussion question to keep the class alive.",
    "5) Bridge back: say you will continue from the board / next part (never restart unless asked).",
    "If outside selected materials, say so briefly and offer the closest related lesson.",
    "board: 2–5 actions that ILLUSTRATE the answer NOW (write_text + draw_circle/draw_arrow/draw_rectangle/draw_line/underline).",
    rtl
      ? "Arabic RTL: write_text x ≈ 1700–1820, diagrams x ≈ 400–700."
      : "LTR: write_text x ≈ 100–220, diagrams x ≈ 1300–1700.",
    "write_text notes max 8 words. Coordinates 0..1920 x 0..1080. y around 700–980.",
    "NEVER dump schema keys. NEVER restart the whole lesson. NEVER answer and go silent without a bridge.",
    materials ? `Selected materials: ${materials}` : "",
    outline ? `Curriculum outline:\n${outline}` : "",
    input.materialExcerpt
      ? `Material excerpt for answering:\n${input.materialExcerpt.slice(0, 2800)}`
      : "",
    input.lessonTitle ? `Current session: ${input.lessonTitle}` : "",
    typeof input.pausedIndex === "number"
      ? `Paused after step ${input.pausedIndex + 1}.`
      : "",
    input.spokenSoFar?.length
      ? `Already taught:\n- ${input.spokenSoFar.slice(-4).join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseClassroomInterrupt(
  raw: string,
  language?: string | null
): ClassroomInterruptResult | null {
  const lang = normalizeClassroomLanguage(language);
  const rtl = lang === "ar";
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    const plain = sanitizeClassroomPlainText(raw, 280);
    if (!plain) return null;
    return {
      answer: plain,
      board: synthesizeInterruptBoard(plain, rtl),
    };
  }
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const answer =
      sanitizeClassroomPlainText(parsed.answer ?? parsed.text ?? parsed.reply, 520) ||
      sanitizeClassroomPlainText(raw, 420);
    if (!answer) return null;
    const boardRaw = Array.isArray(parsed.board)
      ? parsed.board
      : Array.isArray(parsed.whiteboard)
        ? parsed.whiteboard
        : [];
    const board: AiTeacherBoardCue[] = boardRaw
      .map((a, i) => {
        if (!a || typeof a !== "object") return null;
        const row = a as Record<string, unknown>;
        const action = String(row.action || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_");
        if (!action || action === "open_new_board" || action === "clear_board") return null;
        const parameters =
          row.parameters && typeof row.parameters === "object" && !Array.isArray(row.parameters)
            ? { ...(row.parameters as Record<string, unknown>) }
            : {};
        if ("text" in parameters) {
          parameters.text = sanitizeClassroomPlainText(parameters.text, 48);
        }
        return {
          time: Math.max(0, Number(row.time) || i * 400),
          action,
          parameters,
        };
      })
      .filter(Boolean) as AiTeacherBoardCue[];
    return {
      answer,
      board: board.length ? board.slice(0, 5) : synthesizeInterruptBoard(answer, rtl),
    };
  } catch {
    const plain = sanitizeClassroomPlainText(raw, 280);
    if (!plain) return null;
    return { answer: plain, board: synthesizeInterruptBoard(plain, rtl) };
  }
}

function synthesizeInterruptBoard(answer: string, rtl: boolean): AiTeacherBoardCue[] {
  const note = shortBoardNote(answer, 40) || (rtl ? "إجابة" : "Answer");
  const textX = rtl ? 1780 : 120;
  const diagramX = rtl ? 520 : 1500;
  return [
    {
      time: 0,
      action: "write_text",
      parameters: {
        text: note,
        x: textX,
        y: 860,
        size: 26,
        color: "blue",
        align: rtl ? "right" : "left",
      },
    },
    {
      time: 350,
      action: "draw_circle",
      parameters: { cx: diagramX, cy: 820, r: 55, color: "orange", width: 3 },
    },
    {
      time: 700,
      action: "draw_arrow",
      parameters: {
        x1: diagramX - 70,
        y1: 900,
        x2: diagramX + 80,
        y2: 780,
        color: "green",
        width: 3,
      },
    },
  ];
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
