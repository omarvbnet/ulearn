import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { AiProviderService } from "../ai-provider.service";
import {
  StudentMemoryService,
  type ConceptMasteryMap,
  type MaterialEvaluation,
} from "../student-memory.service";
import {
  classroomLanguageLock,
  classroomSpeechLanguage,
  normLang,
  resolveTeacherVoice,
} from "../voice-accent";
import { sanitizeClassroomPlainText } from "../ai-teacher-prompt";
import type { ChatMessage } from "../types";
import { normalizeBoardActions } from "./board-layout";
import { buildClassroomBeatPrompt } from "./classroom-prompts";
import { SubjectAssessmentService } from "@/services/assessment/subject-assessment.service";
import { ClassroomPerfTimer } from "./perf-monitor";
import {
  extractProgressiveBeatFields,
  findBalancedJsonObject,
  type ClassroomStreamEvent,
} from "./progressive-beat";
import {
  cleanMaterialExcerpt,
  isCoverOrMetaLine,
  isPageLessonLabel,
  isWeakLessonTitle,
  nextBoardTopicFromExcerpt,
  topicFromExcerpt,
} from "../material-topic";
import {
  emptyClassroomState,
  type ClassroomBeat,
  type ClassroomBoardAction,
  type ClassroomEmotion,
  type ClassroomLessonStage,
  type ClassroomPace,
  type ClassroomSessionPublic,
  type ClassroomSessionState,
} from "./types";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

/** Strip page-number narration so the teacher never "views pages". */
function stripPageNarration(speak: string[]): string[] {
  return speak
    .map((line) =>
      String(line || "")
        .replace(/\bpages?\s+\d+\s*[–\-]\s*\d+\b/gi, "")
        .replace(/\b(view|open|see|look at|go to|turn to)\s+(the\s+)?pages?\s*\d*\b/gi, "")
        .replace(/\b(page|صفحة|sayfa)\s*\d+\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .replace(/^[,.\s:;\-–—]+|[,.\s:;\-–—]+$/g, "")
        .trim()
    )
    .filter(Boolean);
}

/** Drop spoken lines that only re-announce the material/teacher cover name. */
function stripMetaSpeak(speak: string[], materialNames: string[]): string[] {
  const filtered = speak.filter(
    (line) => !isCoverOrMetaLine(line, materialNames) && line.trim().length > 2
  );
  return filtered.length ? filtered : speak;
}

async function loadLessonMaterialExcerpt(input: {
  userId: string;
  documentIds: string[];
  lessonName?: string | null;
  materialNames?: string[];
  curriculumOutline?: string[];
}): Promise<string> {
  const { AiExamService } = await import("../ai-exam.service");
  const { ExamGeneratorService } = await import("../exam-generator.service");
  let chapter: {
    title: string;
    chunkFrom: number;
    chunkTo: number;
    pageStart: number | null;
    pageEnd: number | null;
  } | null = null;
  const lesson = (input.lessonName || "").trim();
  const materialNames = input.materialNames || [];
  const outline = input.curriculumOutline || [];
  const lessonIndex = lesson ? outline.indexOf(lesson) : -1;
  if (lesson || lessonIndex >= 0) {
    for (const docId of input.documentIds) {
      const chapters = await AiExamService.listDocumentChapters(
        input.userId,
        docId
      );
      // Prefer exact title, then same index in the outline (titles may have
      // been humanized away from cover-page text after session open).
      const hit =
        chapters.find((c) => c.title === lesson) ||
        (lessonIndex >= 0 ? chapters[lessonIndex] : undefined);
      if (hit) {
        chapter = hit;
        break;
      }
    }
  }
  // Scope by page/chunk bounds only — never heading-match a cover/teacher name
  // (that used to load only the PDF cover and loop the same board title).
  const useHeading =
    chapter?.title &&
    !isWeakLessonTitle(chapter.title, materialNames)
      ? chapter.title
      : null;
  const material = await ExamGeneratorService.loadMaterialForDocuments({
    userId: input.userId,
    documentIds: input.documentIds,
    chapterHeading: useHeading,
    chunkFrom: chapter?.chunkFrom ?? null,
    chunkTo: chapter?.chunkTo ?? null,
    pageFrom: chapter?.pageStart ?? null,
    pageTo: chapter?.pageEnd ?? null,
    ordered: true,
    question: lesson || "teach this lesson from the material",
  });
  return cleanMaterialExcerpt(
    (material?.text?.trim() || "").slice(0, 9000),
    materialNames
  );
}

function extractJsonObject(raw: string): string | null {
  const t = raw.trim();
  if (t.startsWith("{") && t.endsWith("}")) return t;
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return null;
}

function clamp01(n: number, fallback = 0.5): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

/** Student explicitly asked to go back to lesson 1 / restart the material. */
const RESTART_PATTERNS: RegExp[] = [
  /\bfrom (the )?(start|beginning)\b/i,
  /\brestart\b/i,
  /\bstart over\b/i,
  /\bfrom (lesson|chapter) (one|1)\b/i,
  /\b(the )?first lesson\b/i,
  /\bback to (the )?(start|beginning|first lesson)\b/i,
  /من البداية/,
  /من الأول/,
  /الدرس الأول/,
  /رجّعني للبداية/,
  /رجعني للبداية/,
  /ابدأ من جديد/,
  /باشتان/i,
  /baştan/i,
  /ilk ders/i,
  /başa dön/i,
];

function wantsRestartFromFirstLesson(text?: string | null): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  return RESTART_PATTERNS.some((re) => re.test(t));
}

/** Split a concept-mastery ledger into the two lists the prompt needs:
 *  concepts to build on quietly vs. concepts that weakened and deserve a
 *  brief, natural review if the moment fits. */
function masteryLists(map: ConceptMasteryMap): { mastered: string[]; weak: string[] } {
  const mastered: string[] = [];
  const weak: string[] = [];
  for (const [topic, entry] of Object.entries(map)) {
    if (entry.status === "mastered") mastered.push(topic);
    else if (entry.status === "weak") weak.push(topic);
  }
  return { mastered, weak };
}

function parseBeat(raw: string): ClassroomBeat | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  try {
    const o = JSON.parse(jsonText) as Record<string, unknown>;
    const speakRaw = Array.isArray(o.speak)
      ? o.speak
      : typeof o.speak === "string"
        ? [o.speak]
        : [];
    const speak = speakRaw
      .map((s) => sanitizeClassroomPlainText(s, 220))
      .filter(Boolean) as string[];
    if (!speak.length) return null;

    const boardRaw = Array.isArray(o.board) ? o.board : [];
    const board: ClassroomBoardAction[] = boardRaw
      .map((row, i) => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        const action = String(r.action || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_");
        if (!action) return null;
        const parameters =
          r.parameters && typeof r.parameters === "object" && !Array.isArray(r.parameters)
            ? { ...(r.parameters as Record<string, unknown>) }
            : {};
        if ("text" in parameters) {
          parameters.text = sanitizeClassroomPlainText(parameters.text, 40);
        }
        return {
          time: Math.max(0, Number(r.time) || i * 350),
          action,
          parameters,
        };
      })
      .filter(Boolean) as ClassroomBoardAction[];

    const emotion = String(o.emotion || "calm") as ClassroomEmotion;
    const pace = String(o.pace || "normal") as ClassroomPace;
    const askStudent = o.askStudent
      ? sanitizeClassroomPlainText(o.askStudent, 160)
      : null;
    const answerCorrect =
      o.answerCorrect === true
        ? true
        : o.answerCorrect === false
          ? false
          : null;
    const teachingStrategy = String(o.teachingStrategy || "").trim();
    const homework = o.homework ? sanitizeClassroomPlainText(o.homework, 200) : null;

    return {
      // Match prompt pedagogy: 2 speak lines + up to 5 board strokes.
      speak: speak.slice(0, 2),
      board: board.slice(0, 5),
      askStudent,
      waitForStudentMs: Math.max(
        0,
        Math.min(8000, Number(o.waitForStudentMs) || (askStudent ? 5500 : 0))
      ),
      emotion: [
        "calm",
        "encouraging",
        "curious",
        "patient",
        "energetic",
        "frustrated",
        "confused",
      ].includes(emotion)
        ? emotion
        : "calm",
      pace: ["slow", "normal", "brisk"].includes(pace) ? pace : "normal",
      lessonName: o.lessonName
        ? sanitizeClassroomPlainText(o.lessonName, 80)
        : null,
      sessionComplete: Boolean(o.sessionComplete),
      answerCorrect,
      teachingStrategy: [
        "example",
        "story",
        "comparison",
        "challenge_question",
        "socratic_question",
        "recap",
      ].includes(teachingStrategy)
        ? (teachingStrategy as ClassroomBeat["teachingStrategy"])
        : null,
      stageComplete: Boolean(o.stageComplete),
      homework: homework || null,
      memoryPatch:
        o.memoryPatch && typeof o.memoryPatch === "object"
          ? (o.memoryPatch as Partial<ClassroomSessionState>)
          : undefined,
    };
  } catch {
    return null;
  }
}

/** Minimum consecutive teaching beats on an idea before a check is allowed. */
const MIN_EXPLAIN_BEATS = 3;

/** Ordered lesson-flow state machine — see ClassroomLessonStage. One full
 *  pass teaches exactly one curriculum lesson; recommend_next loops back to
 *  "objective" (never "greeting", which only ever happens once per session). */
const LESSON_STAGE_ORDER: ClassroomLessonStage[] = [
  "greeting",
  "objective",
  "explain",
  "guided_practice",
  "check_understanding",
  "mini_quiz",
  "summary",
  "homework",
  "recommend_next",
];

/** "What did you understand?" and equivalents are only legitimate once the
 *  explain/practice stages are actually done — a hard textual safety net on
 *  top of the stage-gated askStudent check below, since the model can phrase
 *  a premature understanding probe as a plain spoken line instead of a
 *  formal askStudent. */
const PREMATURE_UNDERSTANDING_PATTERNS: RegExp[] = [
  /what (do|did) you understand/i,
  /do you understand (it|this|that)? ?now/i,
  /are you ready/i,
  /ready to (start|begin|learn)/i,
  /does that (make sense|feel clear)/i,
  /any questions\b/i,
  /ماذا فهمت/,
  /شو فهمت/,
  /شنو فهمت/,
  /هل فهمت/,
  /هل أنت جاهز/,
  /جاهز\s*[؟?]/,
  /واضح\s*(لك)?\s*[؟?]/,
  /ne anladın/i,
  /anladın mı/i,
  /hazır mısın/i,
  /anlaştı mı/i,
];

function stripPrematureUnderstandingCheck(
  speak: string[],
  stage: ClassroomLessonStage
): string[] {
  if (stage === "check_understanding" || stage === "mini_quiz" || !speak.length) {
    return speak;
  }
  const filtered = speak.filter(
    (line) => !PREMATURE_UNDERSTANDING_PATTERNS.some((re) => re.test(line))
  );
  return filtered.length ? filtered : speak;
}

/**
 * Safety net against the model looping back to the lesson intro: drops any
 * spoken line that is a verbatim repeat of something already said, or that
 * is just a short re-announcement of the current lesson's name (e.g. "Today
 * we'll learn about X" said again three beats later). Never touches MODE
 * OPEN, where announcing the lesson is expected exactly once.
 */
function stripRepeatedIntro(
  speak: string[],
  state: ClassroomSessionState,
  mode: "open" | "next" | "react" | "silence"
): string[] {
  if (mode === "open" || !speak.length) return speak;
  const lessonName = (state.currentLessonName || "").trim().toLowerCase();
  const alreadySaid = new Set(
    state.spokenHistory.map((s) => s.trim().toLowerCase())
  );
  const filtered = speak.filter((line) => {
    const norm = line.trim().toLowerCase();
    if (!norm) return false;
    if (alreadySaid.has(norm)) return false;
    if (lessonName && norm.includes(lessonName) && norm.length < lessonName.length + 40) {
      return false;
    }
    return true;
  });
  return filtered.length ? filtered : speak;
}

function finalizeBeat(
  beat: ClassroomBeat,
  state: ClassroomSessionState,
  language: string,
  mode: "open" | "next" | "react" | "silence" = "next"
): ClassroomBeat {
  const rtl =
    language.toLowerCase().startsWith("ar") ||
    language.toLowerCase().startsWith("ku");
  const ar = rtl;
  const tr = language.toLowerCase().startsWith("tr");
  const stage: ClassroomLessonStage = state.lessonStage || "greeting";

  let speak = stripRepeatedIntro(
    [...(beat.speak || [])].filter(Boolean),
    state,
    mode
  );
  const materialNames = state.materialNames || [];
  speak = stripPrematureUnderstandingCheck(speak, stage);
  speak = stripPageNarration(speak);
  speak = stripMetaSpeak(speak, materialNames);
  let board = [...(beat.board || [])]
    .map((b) => {
      const text = b.parameters?.text;
      if (typeof text === "string" && isWeakLessonTitle(text, materialNames)) {
        return {
          ...b,
          parameters: {
            ...b.parameters,
            text: nextBoardTopicFromExcerpt(
              state.materialExcerpt || "",
              state.boardSummary || [],
              materialNames,
              ar ? "فكرة الدرس" : tr ? "Ders fikri" : "Key idea"
            ),
          },
        };
      }
      return b;
    })
    .filter((b) => {
      // Drop duplicate write_text that just repeats what's already on the board.
      const text = String(b.parameters?.text || "").trim();
      if (!text || !/write_text|draw_formula|draw_equation/i.test(String(b.action))) {
        return true;
      }
      const key = text.toLowerCase().slice(0, 22);
      return !(state.boardSummary || []).some(
        (s) => s.toLowerCase().slice(0, 22) === key
      );
    });

  const pickVariant = <T,>(arr: T[]): T =>
    arr[Math.floor(Date.now() / 137) % arr.length]!;

  // Wrong answer must always continue with voice + board re-explanation.
  if (beat.answerCorrect === false) {
    if (!speak.length) {
      speak = [
        pickVariant(
          ar
            ? ["نفس الفكرة مرة ثانية بهدوء.", "لنعد هذه الفكرة خطوة بخطوة.", "خلّينا نبسّطها أكثر."]
            : tr
              ? ["Aynı fikri sakin sakin tekrar edelim.", "Bunu adım adım yeniden görelim.", "Biraz daha basitleştirelim."]
              : ["Same idea again, slowly and clearly.", "Let's walk through this one more time.", "Let's simplify this a bit more."]
        ),
      ];
    }
    const hasText = board.some((b) =>
      /write_text|draw_formula|draw_equation/i.test(String(b.action || ""))
    );
    if (!hasText) {
      const hint =
        sanitizeClassroomPlainText(state.pendingAnswerHint, 24) ||
        sanitizeClassroomPlainText(state.currentTopic, 24) ||
        (ar ? "الفكرة الأساسية" : tr ? "Ana fikir" : "Key idea");
      board = [
        {
          time: 0,
          action: "write_text",
          parameters: {
            text: hint,
            color: "blue",
            size: 56,
          },
        },
        ...board,
      ];
    }
    // Keep asking the same check after re-explain.
    if (!beat.askStudent && state.pendingQuestion) {
      beat = { ...beat, askStudent: state.pendingQuestion };
    }
  }

  // Correct answer: continue teaching on board if empty.
  if (beat.answerCorrect === true) {
    const hasText = board.some((b) =>
      /write_text|draw_formula|draw_equation/i.test(String(b.action || ""))
    );
    if (!hasText) {
      board = [
        {
          time: 0,
          action: "write_text",
          parameters: {
            text: ar ? "الخطوة التالية" : tr ? "Sonraki adım" : "Next step",
            color: "green",
            size: 56,
          },
        },
      ];
    }
    if (!speak.length) {
      speak = [
        pickVariant(
          ar
            ? ["لنكمل الخطوة التالية.", "تمام، نكمل للفكرة الجاية.", "زين، خطوة جديدة الحين."]
            : tr
              ? ["Şimdi sonraki adıma geçelim.", "Harika, bir sonraki fikre geçiyoruz.", "Tamam, şimdi yeni bir adım."]
              : ["Let’s continue with the next step.", "Great, let's move to the next idea.", "Alright, on to something new."]
        ),
      ];
    }
  }

  let ask =
    beat.askStudent ||
    (speak.length && /[?؟]$/.test(speak[speak.length - 1] || "")
      ? speak[speak.length - 1]
      : null);
  // ABSOLUTE RULE: checks/quizzes are ONLY allowed in check_understanding /
  // mini_quiz. MODE OPEN, explain, practice, summary, etc. must NEVER leave
  // an askStudent hanging — a single premature "Are you ready?" / "What did
  // you understand?" used to set awaitingCorrectAnswer and trap the whole
  // session in question-only mode with an empty board.
  const stageAllowsCheck = stage === "check_understanding" || stage === "mini_quiz";
  const notDeepEnoughYet =
    stage === "check_understanding" && (state.explainBeats || 0) < MIN_EXPLAIN_BEATS;
  // Strip asks outside check/quiz stages (and always on MODE OPEN). Inside
  // check_understanding, the depth gate only blocks a brand-new check — a
  // still-pending re-ask after a wrong/silent answer must stay alive.
  if (!stageAllowsCheck || mode === "open") {
    ask = null;
  } else if (notDeepEnoughYet && !state.awaitingCorrectAnswer) {
    ask = null;
  }
  // Ensure check questions are spoken aloud.
  if (ask && !speak.some((s) => s.includes(ask!.slice(0, 12)))) {
    speak.push(ask);
  }
  // If the model only produced a forbidden question, replace with a real
  // teaching line so the student never hears a blank/question-only beat
  // during explain/practice.
  if (
    !speak.length &&
    !ask &&
    (mode === "open" ||
      stage === "explain" ||
      stage === "guided_practice" ||
      stage === "objective")
  ) {
    const topic = nextBoardTopicFromExcerpt(
      state.materialExcerpt || "",
      state.boardSummary || [],
      materialNames,
      sanitizeClassroomPlainText(state.currentTopic, 40) ||
        (ar ? "الفكرة" : tr ? "fikir" : "this idea")
    );
    speak = [
      ar
        ? `خلّينا نشرح ${topic} على السبورة بخطوة واضحة.`
        : tr
          ? `${topic} konusunu tahtada net şekilde anlatalım.`
          : `Let’s explain ${topic} clearly on the board, step by step.`,
    ];
  }
  // During teaching stages, always put something readable on the board if
  // the model forgot — never the PDF/teacher cover name, and never a repeat.
  const hasBoardInk = board.some((b) =>
    /write_text|draw_|underline|circle_highlight|point_at/i.test(String(b.action || ""))
  );
  if (
    !hasBoardInk &&
    (mode === "open" ||
      stage === "explain" ||
      stage === "guided_practice" ||
      stage === "objective")
  ) {
    const title = nextBoardTopicFromExcerpt(
      state.materialExcerpt || "",
      state.boardSummary || [],
      materialNames,
      ar ? "فكرة الدرس" : tr ? "Ders fikri" : "Key idea"
    );
    board = [
      {
        time: 0,
        action: "write_text",
        parameters: { text: title, color: "blue", size: 58 },
      },
      {
        time: 1,
        action: "draw_circle",
        parameters: { color: "red", r: 48 },
      },
      ...board,
    ];
  }
  if (
    hasBoardInk &&
    (stage === "explain" || stage === "guided_practice") &&
    !board.some((b) => /^draw_/i.test(String(b.action || "")))
  ) {
    // Teaching beat with text only — add one simple diagram stroke so the
    // board animates like a short video of the subject.
    board = [
      ...board,
      {
        time: board.length,
        action: "draw_arrow",
        parameters: { color: "green" },
      },
    ];
  }
  const layout = normalizeBoardActions(board, {
    rtl,
    cursorY: state.boardCursorY || 160,
  });
  // Homework may only ever leave this function when the lesson-flow state
  // machine is actually in the homework stage — strip it everywhere else
  // regardless of what the model produced.
  const homework = stage === "homework" ? beat.homework || null : null;
  // Curriculum can only advance to a genuinely new lesson from the
  // recommend_next stage (or the very first MODE OPEN beat of the whole
  // session) — this is what stops the AI from randomly jumping topics.
  let lessonName =
    mode === "open" || stage === "recommend_next" ? beat.lessonName || null : null;
  if (lessonName && isWeakLessonTitle(lessonName, materialNames)) {
    lessonName = topicFromExcerpt(
      state.materialExcerpt || "",
      sanitizeClassroomPlainText(state.currentTopic, 48) || "",
      materialNames
    );
    if (isWeakLessonTitle(lessonName, materialNames)) lessonName = null;
  }
  return {
    ...beat,
    speak: speak.slice(0, 3),
    board: layout.actions,
    askStudent: ask,
    homework,
    lessonName,
    waitForStudentMs: ask
      ? Math.max(5000, beat.waitForStudentMs || 5500)
      : beat.waitForStudentMs || 0,
    memoryPatch: {
      ...(beat.memoryPatch || {}),
      boardCursorY: layout.nextCursorY,
      ...(layout.cleared ? { boardSummary: [] } : {}),
    },
  };
}

/** Rotating fallback lines so a repeated fallback never sounds like a broken record. */
const FALLBACK_REACT_LINES: Record<"ar" | "tr" | "en", string[]> = {
  ar: [
    "سؤال ممتاز. دعنا نوضّح الفكرة على السبورة، ثم نكمل معاً.",
    "فكرة جيدة. لنرسمها على السبورة ونكمل خطوة بخطوة.",
    "تمام، لنركّز على هذه النقطة قليلاً ثم نتابع.",
  ],
  tr: [
    "Harika soru. Tahtada netleştirelim, sonra birlikte devam edelim.",
    "Güzel nokta. Tahtada gösterelim, sonra devam edelim.",
    "Tamam, buna biraz odaklanalım, sonra ilerleyelim.",
  ],
  en: [
    "Excellent question. Let’s clarify it on the board, then continue together.",
    "Good point — let’s sketch it on the board and keep going step by step.",
    "Alright, let’s focus on that for a moment, then move forward.",
  ],
};
const FALLBACK_REACT_ASK: Record<"ar" | "tr" | "en", string[]> = {
  ar: [
    "هل هذا واضح لك الآن؟",
    "طيب، كيف تشرح هذه الفكرة بكلماتك؟",
    "هل تقدر تعطيني مثالاً على هذه الفكرة؟",
  ],
  tr: [
    "Şimdi bu netleşti mi?",
    "Peki, bunu kendi cümlelerinle nasıl anlatırsın?",
    "Bu fikre bir örnek verebilir misin?",
  ],
  en: [
    "Does that feel clear now?",
    "Okay, how would you explain that back in your own words?",
    "Can you give me an example of that idea?",
  ],
};

function fallbackBeat(
  language: string,
  mode: "open" | "next" | "react",
  lessonName?: string | null,
  variant = 0,
  stage?: ClassroomLessonStage | null,
  countryCode?: string | null,
  provinceName?: string | null
): ClassroomBeat {
  // Match TTS delivery language (KU UI → ar/tr), not raw locale equality.
  const speech = classroomSpeechLanguage({ language, countryCode, provinceName });
  const ar = speech === "ar";
  const tr = speech === "tr";
  const key: "ar" | "tr" | "en" = ar ? "ar" : tr ? "tr" : "en";
  const i = Math.abs(variant) % 3;
  const rawTitle = (lessonName || "").trim();
  const title =
    rawTitle && !isWeakLessonTitle(rawTitle, [])
      ? rawTitle
      : ar
        ? "درس اليوم"
        : tr
          ? "Bugünün dersi"
          : "Today's lesson";
  const boardTitle = {
    time: 0,
    action: "write_text",
    parameters: {
      text: title.slice(0, 28),
      x: ar ? 1780 : 120,
      y: 120,
      size: 58,
      color: "blue",
      align: ar ? "right" : "left",
    },
  };
  // Only fall back to a spoken check when we are genuinely in a check/quiz
  // stage — otherwise a generic "are you ready?" used to freeze the lesson.
  const stageAllowsAsk =
    stage === "check_understanding" || stage === "mini_quiz";
  if (mode === "react" && stageAllowsAsk) {
    return {
      speak: [FALLBACK_REACT_LINES[key][i]!],
      board: [
        {
          time: 0,
          action: "write_text",
          parameters: {
            text: ar ? "فكرة مهمة" : tr ? "Önemli fikir" : "Key idea",
            x: ar ? 1780 : 120,
            y: 820,
            size: 56,
            color: "blue",
            align: ar ? "right" : "left",
          },
        },
      ],
      askStudent: FALLBACK_REACT_ASK[key][i]!,
      waitForStudentMs: 4800,
      emotion: "encouraging",
      pace: "slow",
      teachingStrategy: "recap",
      lessonName: lessonName || null,
    };
  }
  if (mode === "react") {
    // Student spoke during teaching — explain on the board, do NOT quiz.
    return {
      speak: [
        ar
          ? "فكرة ممتازة. دعنا نوضحها على السبورة ثم نكمل الشرح."
          : tr
            ? "Güzel nokta. Tahtada açıklayalım, sonra anlatmaya devam edelim."
            : "Good point. Let’s clarify it on the board, then keep explaining.",
      ],
      board: [boardTitle],
      askStudent: null,
      waitForStudentMs: 0,
      emotion: "encouraging",
      pace: "normal",
      teachingStrategy: "example",
      lessonName: null,
      stageComplete: false,
    };
  }
  if (mode === "next") {
    return {
      speak: [
        ar
          ? `لنشرح ${title} على السبورة خطوة بخطوة.`
          : tr
            ? `${title} konusunu tahtada adım adım anlatalım.`
            : `Let’s explain ${title} on the board, step by step.`,
      ],
      board: [boardTitle],
      askStudent: null,
      waitForStudentMs: 0,
      emotion: "calm",
      pace: "normal",
      teachingStrategy: "example",
      lessonName: null,
      stageComplete: false,
      memoryPatch: { currentTopic: title.slice(0, 40) },
    };
  }
  // MODE OPEN — welcome + objective on the board. Never ask a question here.
  return {
    speak: [
      ar
        ? "مرحباً. لنبدأ درسنا معاً بهدوء ووضوح."
        : tr
          ? "Merhaba. Dersimize sakin ve net bir şekilde başlayalım."
          : "Welcome. Let’s begin our lesson together — clear and calm.",
      ar
        ? `موضوعنا الآن: ${title}`
        : tr
          ? `Bugünkü konumuz: ${title}`
          : `Our focus now: ${title}`,
    ],
    board: [boardTitle],
    askStudent: null,
    waitForStudentMs: 0,
    emotion: "encouraging",
    pace: "normal",
    teachingStrategy: "example",
    lessonName: lessonName || null,
    stageComplete: true,
    memoryPatch: { currentTopic: title.slice(0, 40) },
  };
}

/** Deterministic evaluation text used when the AI call is unavailable/fails. */
function fallbackEvaluationText(
  language: string,
  understanding: number
): {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
} {
  const ar =
    language.toLowerCase().startsWith("ar") || language.toLowerCase().startsWith("ku");
  const tr = language.toLowerCase().startsWith("tr");
  const pct = Math.round(clamp01(understanding) * 100);
  const good = pct >= 70;
  return {
    summary: ar
      ? `أداؤك في هذه المادة ${good ? "جيد جداً" : "بحاجة إلى مزيد من التدريب"}. نسبة استيعابك التقديرية ${pct}%.`
      : tr
        ? `Bu materyaldeki performansın ${good ? "oldukça iyi" : "daha fazla pratiğe ihtiyaç duyuyor"}. Tahmini anlama oranın %${pct}.`
        : `Your performance in this material is ${good ? "quite strong" : "still developing"}. Estimated understanding is ${pct}%.`,
    strengths: good
      ? [
          ar
            ? "فهم جيد للأفكار الأساسية"
            : tr
              ? "Ana fikirleri iyi anlama"
              : "Good grasp of the core ideas",
        ]
      : [],
    weaknesses: !good
      ? [
          ar
            ? "يحتاج مراجعة إضافية للمفاهيم الأساسية"
            : tr
              ? "Temel kavramların tekrarına ihtiyacı var"
              : "Needs extra review of the core concepts",
        ]
      : [],
    recommendation: ar
      ? "استمر بالتدريب مع المعلم الذكي على نفس المادة."
      : tr
        ? "Aynı materyalle AI öğretmenle pratik yapmaya devam et."
        : "Keep practicing this material with the AI teacher.",
  };
}

/** Deterministically advances the lesson-flow state machine one step at a
 *  time. beat.stageComplete is only ever a SIGNAL — every transition also
 *  requires concrete, code-verified evidence (an example was actually
 *  taught, an answer was actually correct, N quiz rounds actually
 *  resolved), so the AI can never talk its way past a stage it hasn't
 *  really finished. A per-stage beat-count safety valve prevents an
 *  honest-mistake stall (model forgets stageComplete) from freezing the
 *  lesson forever, EXCEPT for check_understanding, which must keep
 *  re-explaining and re-asking for as long as the student keeps missing it
 *  — that persistence is intentional, not a bug. */
type LessonStageAdvance = Pick<
  ClassroomSessionState,
  | "lessonStage"
  | "stageBeats"
  | "hasGivenExample"
  | "quizProgress"
  | "homeworkGiven"
  | "currentWhiteboardStep"
  | "currentExample"
  | "currentPractice"
  | "currentQuiz"
  | "currentSummary"
>;

/** Fresh lesson-state memory when starting a new curriculum lesson. */
function freshLessonArtifacts(): Pick<
  ClassroomSessionState,
  | "hasGivenExample"
  | "quizProgress"
  | "homeworkGiven"
  | "currentWhiteboardStep"
  | "currentExample"
  | "currentPractice"
  | "currentQuiz"
  | "currentSummary"
> {
  return {
    hasGivenExample: false,
    quizProgress: 0,
    homeworkGiven: false,
    currentWhiteboardStep: null,
    currentExample: null,
    currentPractice: null,
    currentQuiz: null,
    currentSummary: null,
  };
}

/**
 * Persist the active lesson-state artifacts from concrete beat evidence —
 * board text, spoken example, practice prompt, quiz question, summary —
 * never from chat-history inference alone. Called after every beat so the
 * next response always continues from an explicit, up-to-date state object.
 */
function updateLessonStateMemory(
  state: ClassroomSessionState,
  beat: ClassroomBeat,
  stage: ClassroomLessonStage
): Pick<
  ClassroomSessionState,
  | "currentWhiteboardStep"
  | "currentExample"
  | "currentPractice"
  | "currentQuiz"
  | "currentSummary"
> {
  const patch = beat.memoryPatch || {};
  const boardNote =
    beat.board
      .map((b) => sanitizeClassroomPlainText(b.parameters?.text, 48))
      .filter(Boolean)
      .slice(-1)[0] || null;
  const speakNote =
    sanitizeClassroomPlainText(beat.speak?.[beat.speak.length - 1], 80) || null;
  const askNote =
    sanitizeClassroomPlainText(beat.askStudent, 80) || null;

  let currentWhiteboardStep =
    sanitizeClassroomPlainText(patch.currentWhiteboardStep, 80) ||
    boardNote ||
    state.currentWhiteboardStep ||
    null;
  let currentExample =
    sanitizeClassroomPlainText(patch.currentExample, 100) ||
    state.currentExample ||
    null;
  let currentPractice =
    sanitizeClassroomPlainText(patch.currentPractice, 100) ||
    state.currentPractice ||
    null;
  let currentQuiz =
    sanitizeClassroomPlainText(patch.currentQuiz, 100) ||
    state.currentQuiz ||
    null;
  let currentSummary =
    sanitizeClassroomPlainText(patch.currentSummary, 160) ||
    state.currentSummary ||
    null;

  // Stage-bound writes only — never let a later-stage artifact appear early.
  if (stage === "explain" || stage === "objective" || stage === "greeting") {
    if (
      beat.teachingStrategy === "example" ||
      beat.board.some((b) => /^draw_/.test(String(b.action || "")))
    ) {
      currentExample =
        sanitizeClassroomPlainText(patch.currentExample, 100) ||
        boardNote ||
        speakNote ||
        currentExample;
    }
    if (boardNote) currentWhiteboardStep = boardNote;
  } else if (stage === "guided_practice") {
    currentPractice =
      sanitizeClassroomPlainText(patch.currentPractice, 100) ||
      askNote ||
      speakNote ||
      currentPractice;
    if (boardNote) currentWhiteboardStep = boardNote;
  } else if (stage === "check_understanding" || stage === "mini_quiz") {
    currentQuiz =
      sanitizeClassroomPlainText(patch.currentQuiz, 100) ||
      askNote ||
      currentQuiz;
  } else if (stage === "summary") {
    currentSummary =
      sanitizeClassroomPlainText(patch.currentSummary, 160) ||
      (beat.speak || []).map((s) => sanitizeClassroomPlainText(s, 80)).filter(Boolean).join(" ") ||
      currentSummary;
  }

  return {
    currentWhiteboardStep,
    currentExample,
    currentPractice,
    currentQuiz,
    currentSummary,
  };
}

function advanceLessonStage(
  state: ClassroomSessionState,
  beat: ClassroomBeat,
  mode: "open" | "next" | "react" | "silence"
): LessonStageAdvance {
  const stage: ClassroomLessonStage = state.lessonStage || "greeting";
  const stageBeats = (state.stageBeats || 0) + 1;
  let hasGivenExample = Boolean(state.hasGivenExample);
  let quizProgress = state.quizProgress || 0;
  let homeworkGiven = Boolean(state.homeworkGiven);
  const artifacts = updateLessonStateMemory(state, beat, stage);

  // A real example needs spoken content AND a matching drawing — a lone
  // decorative shape must not end the explain stage early.
  if (
    stage === "explain" &&
    Boolean(artifacts.currentExample || beat.teachingStrategy === "example") &&
    beat.board.some((b) => /^draw_/.test(String(b.action || ""))) &&
    (beat.speak || []).some((s) => String(s || "").trim().length > 12)
  ) {
    hasGivenExample = true;
  }
  if (
    stage === "mini_quiz" &&
    mode === "react" &&
    (beat.answerCorrect === true || beat.answerCorrect === false)
  ) {
    quizProgress += 1;
  }
  if (stage === "homework" && beat.homework) {
    homeworkGiven = true;
  }

  // The very first beat of the whole session (MODE OPEN) covers BOTH
  // greeting and objective at once — jump straight into teaching content.
  if (mode === "open") {
    return {
      lessonStage: "explain",
      stageBeats: 0,
      ...freshLessonArtifacts(),
      // Keep any whiteboard title / topic written during the open beat.
      currentWhiteboardStep: artifacts.currentWhiteboardStep,
    };
  }

  const claimsComplete = Boolean(beat.stageComplete);
  let shouldAdvance: boolean;
  switch (stage) {
    case "greeting":
    case "objective":
    case "summary":
    case "homework":
    case "recommend_next":
      // Single-beat stages — always move on immediately.
      shouldAdvance = true;
      break;
    case "explain":
      shouldAdvance =
        (claimsComplete && hasGivenExample && stageBeats >= MIN_EXPLAIN_BEATS) ||
        stageBeats >= 10;
      break;
    case "guided_practice":
      shouldAdvance = (claimsComplete && stageBeats >= 1) || stageBeats >= 3;
      break;
    case "check_understanding":
      // Only a genuinely CORRECT resolved answer ends the check — a wrong
      // answer must stay here and keep re-explaining/re-asking, exactly
      // the "correct misconceptions" loop the student needs.
      shouldAdvance = mode === "react" && beat.answerCorrect === true;
      break;
    case "mini_quiz":
      shouldAdvance = quizProgress >= 2 || stageBeats >= 6;
      break;
    default:
      shouldAdvance = true;
  }

  if (!shouldAdvance) {
    return {
      lessonStage: stage,
      stageBeats,
      hasGivenExample,
      quizProgress,
      homeworkGiven,
      ...artifacts,
    };
  }

  if (stage === "recommend_next") {
    // Loop into the next curriculum lesson — "greeting" only ever happens
    // once for the whole session, so a new lesson starts at "objective".
    // Wipe stage artifacts so the next lesson cannot inherit the previous
    // example/quiz/summary as if they were still current.
    return {
      lessonStage: "objective",
      stageBeats: 0,
      ...freshLessonArtifacts(),
    };
  }
  const idx = LESSON_STAGE_ORDER.indexOf(stage);
  const nextStage = LESSON_STAGE_ORDER[idx + 1] || "explain";
  // Keep completed artifacts (example/practice/quiz/summary) as history the
  // prompt can reference, but clear the whiteboard step when leaving explain
  // so the next stage starts a clean visual beat unless it draws again.
  return {
    lessonStage: nextStage,
    stageBeats: 0,
    hasGivenExample,
    quizProgress,
    homeworkGiven,
    currentWhiteboardStep:
      nextStage === "explain" || nextStage === "guided_practice"
        ? artifacts.currentWhiteboardStep
        : null,
    currentExample: artifacts.currentExample,
    currentPractice: artifacts.currentPractice,
    currentQuiz: artifacts.currentQuiz,
    currentSummary: artifacts.currentSummary,
  };
}

function mergeState(
  state: ClassroomSessionState,
  beat: ClassroomBeat,
  studentTranscript?: string,
  mode: "open" | "next" | "react" | "silence" = "next"
): ClassroomSessionState {
  const next: ClassroomSessionState = {
    ...emptyClassroomState(state.materialExcerpt),
    ...state,
  };
  const patch = beat.memoryPatch || {};
  if (patch.currentLessonName) next.currentLessonName = String(patch.currentLessonName);
  if (patch.currentTopic) next.currentTopic = String(patch.currentTopic);
  // Explanation-depth tracking: a fresh check resets it, a new topic resets
  // it, repeating a pending question (silence) leaves it untouched, and any
  // other teaching beat that didn't ask deepens it by one.
  const topicChanged = Boolean(
    patch.currentTopic && patch.currentTopic !== state.currentTopic
  );
  if (mode === "silence") {
    next.explainBeats = state.explainBeats || 0;
  } else if (topicChanged || beat.askStudent) {
    next.explainBeats = 0;
  } else {
    next.explainBeats = (state.explainBeats || 0) + 1;
  }
  if (beat.lessonName) next.currentLessonName = beat.lessonName;
  if (patch.emotionalState) next.emotionalState = patch.emotionalState as ClassroomEmotion;
  else next.emotionalState = beat.emotion;
  if (typeof patch.understanding === "number")
    next.understanding = clamp01(patch.understanding, next.understanding);
  if (typeof patch.attention === "number") {
    next.attention = clamp01(patch.attention, next.attention);
  } else if (mode === "silence") {
    // The student didn't answer in time — a real signal of dropping
    // attention, even if the model didn't self-report it.
    next.attention = Math.max(0.2, next.attention - 0.12);
  } else if (beat.answerCorrect === true) {
    next.attention = clamp01(next.attention + 0.05, next.attention);
  }
  if (typeof patch.confidence === "number")
    next.confidence = clamp01(patch.confidence, next.confidence);
  if (patch.learningSpeed === "slow" || patch.learningSpeed === "normal" || patch.learningSpeed === "fast") {
    next.learningSpeed = patch.learningSpeed;
  }
  // Deterministic answer streaks — never just trust the model's self-report,
  // so challengeLevel adaptation below is always grounded in real outcomes.
  if (beat.answerCorrect === true) {
    next.consecutiveCorrect = (state.consecutiveCorrect || 0) + 1;
    next.consecutiveWrong = 0;
  } else if (beat.answerCorrect === false) {
    next.consecutiveWrong = (state.consecutiveWrong || 0) + 1;
    next.consecutiveCorrect = 0;
  }
  // Real difficulty adaptation: confident streaks push the teacher to
  // challenge the student more; struggling streaks pull back to basics.
  if (next.consecutiveCorrect >= 2 && next.confidence >= 0.65) {
    next.challengeLevel = "advanced";
  } else if (
    next.consecutiveWrong >= 2 ||
    next.emotionalState === "frustrated" ||
    next.confidence <= 0.35
  ) {
    next.challengeLevel = "gentle";
  } else if (next.consecutiveWrong === 0 && next.consecutiveCorrect <= 1) {
    next.challengeLevel = "standard";
  }
  if (beat.teachingStrategy) {
    next.strategyHistory = [...(state.strategyHistory || []), beat.teachingStrategy].slice(-3);
  }
  if (typeof patch.boardCursorY === "number" && Number.isFinite(patch.boardCursorY)) {
    next.boardCursorY = Math.max(120, Math.min(980, patch.boardCursorY));
  }
  if (Array.isArray(patch.mistakes)) {
    next.mistakes = [...next.mistakes, ...asStringArray(patch.mistakes)].slice(-12);
  }
  if (Array.isArray(patch.interests)) {
    next.interests = [...next.interests, ...asStringArray(patch.interests)].slice(-12);
  }
  if (Array.isArray(patch.boardSummary)) {
    next.boardSummary = asStringArray(patch.boardSummary).slice(-16);
  } else {
    const notes = beat.board
      .map((b) => sanitizeClassroomPlainText(b.parameters?.text, 40))
      .filter(Boolean) as string[];
    if (notes.length) next.boardSummary = [...next.boardSummary, ...notes].slice(-16);
  }
  next.spokenHistory = [...next.spokenHistory, ...beat.speak].slice(-24);
  next.lastAskStudent = beat.askStudent || next.lastAskStudent;

  if (beat.answerCorrect === true) {
    next.awaitingCorrectAnswer = false;
    next.pendingQuestion = null;
    next.pendingAnswerHint = null;
    next.pendingAttempts = 0;
    next.understanding = clamp01(next.understanding + 0.08, next.understanding);
    next.confidence = clamp01(next.confidence + 0.08, next.confidence);
  } else if (beat.askStudent) {
    next.awaitingCorrectAnswer = true;
    next.pendingQuestion = beat.askStudent;
    next.pendingAnswerHint =
      sanitizeClassroomPlainText(patch.pendingAnswerHint, 80) ||
      next.pendingAnswerHint;
    if (beat.answerCorrect === false) {
      next.pendingAttempts = (next.pendingAttempts || 0) + 1;
      next.mistakes = [
        ...next.mistakes,
        studentTranscript?.trim() || "incorrect attempt",
      ].slice(-12);
      next.understanding = Math.max(0.15, next.understanding - 0.08);
      next.confidence = Math.max(0.15, next.confidence - 0.06);
      // Two or more wrong attempts in a row is a real frustration signal —
      // one miss is just "patient" re-teaching, a repeated miss is the
      // student genuinely struggling and needs a slower, simpler pass.
      next.emotionalState = next.consecutiveWrong >= 2 ? "frustrated" : "patient";
      next.learningSpeed = "slow";
    }
  }

  if (studentTranscript?.trim()) {
    next.studentQuestions = [...next.studentQuestions, studentTranscript.trim()].slice(
      -16
    );
  }
  Object.assign(next, advanceLessonStage(state, beat, mode));
  // Drop stale pending checks when we are not in a check/quiz stage — this
  // recovers sessions that previously got stuck asking unknown questions
  // forever after a premature askStudent from MODE OPEN / explain.
  const liveStage = next.lessonStage || "greeting";
  if (liveStage !== "check_understanding" && liveStage !== "mini_quiz") {
    next.awaitingCorrectAnswer = false;
    next.pendingQuestion = null;
    next.pendingAnswerHint = null;
    next.pendingAttempts = 0;
  }
  return next;
}

/** Fire-and-forget long-term memory updates every time a beat resolves:
 *  record concept evidence when a check question was just judged, and mark
 *  the previous lesson complete the moment the teacher moves to a new one
 *  — this is what lets future sessions skip straight past what's already
 *  done instead of starting from zero. */
function applyLongTermMemory(
  userId: string,
  materialsKey: string,
  state: ClassroomSessionState,
  beat: ClassroomBeat,
  nextState: ClassroomSessionState
) {
  if (!materialsKey) return;
  if (beat.answerCorrect === true || beat.answerCorrect === false) {
    const topic = (state.currentTopic || state.currentLessonName || "").trim();
    if (topic) {
      void StudentMemoryService.recordConceptEvidence(
        userId,
        materialsKey,
        topic,
        beat.answerCorrect
      );
    }
  }
  if (
    beat.lessonName &&
    state.currentLessonName &&
    beat.lessonName !== state.currentLessonName
  ) {
    void StudentMemoryService.markLessonCompleted(
      userId,
      materialsKey,
      state.currentLessonName
    );
    if (!nextState.materialCompletedLessons.includes(state.currentLessonName)) {
      nextState.materialCompletedLessons = [
        ...nextState.materialCompletedLessons,
        state.currentLessonName,
      ];
    }
  }
  // Opportunistically refresh the Subject Scorecard whenever new concept
  // evidence or a completed lesson lands — throttled so a live beat loop
  // never adds noticeable latency.
  void SubjectAssessmentService.recomputeFromDocumentsThrottled(
    userId,
    materialsKey.split(",").filter(Boolean)
  ).catch(() => {});
}

function toPublic(
  row: {
    id: string;
    status: string;
    locale: string;
    countryCode: string | null;
    provinceName: string | null;
    documentIds: string[];
    materialNames: string[];
    curriculumOutline: unknown;
    beatIndex: number;
    state: unknown;
  },
  speechLocale: string,
  accent: string
): ClassroomSessionPublic {
  const state = (row.state || {}) as ClassroomSessionState;
  return {
    id: row.id,
    status: row.status as ClassroomSessionPublic["status"],
    locale: row.locale,
    countryCode: row.countryCode,
    provinceName: row.provinceName,
    documentIds: row.documentIds || [],
    materialNames: row.materialNames || [],
    curriculumOutline: asStringArray(row.curriculumOutline),
    beatIndex: row.beatIndex,
    speechLocale,
    accent,
    state: {
      currentLessonName: state.currentLessonName ?? null,
      currentTopic: state.currentTopic ?? null,
      emotionalState: state.emotionalState || "calm",
      understanding: state.understanding ?? 0.5,
      confidence: state.confidence ?? 0.5,
      lastAskStudent: state.lastAskStudent ?? null,
      awaitingCorrectAnswer: Boolean(state.awaitingCorrectAnswer),
      pendingQuestion: state.pendingQuestion ?? null,
      lessonStage: state.lessonStage || "greeting",
      currentWhiteboardStep: state.currentWhiteboardStep ?? null,
      currentExample: state.currentExample ?? null,
      currentPractice: state.currentPractice ?? null,
      currentQuiz: state.currentQuiz ?? null,
      currentSummary: state.currentSummary ?? null,
    },
  };
}

export class ClassroomSessionService {
  static async startSession(input: {
    userId: string;
    documentIds?: string[];
    language?: string | null;
    question?: string | null;
    conversationId?: string | null;
    /** When set, emits progressive SSE events as soon as speak/board are ready. */
    onEvent?: (event: ClassroomStreamEvent) => void;
  }) {
    const emit = input.onEvent;
    const perf = new ClassroomPerfTimer("session.start");
    emit?.({
      type: "status",
      presence: "thinking",
      message: "Preparing classroom…",
    });
    // Independent lookups (billing entitlement, profile, long-term memory)
    // hit different tables with no data dependency on each other — run them
    // concurrently instead of one after another to shave real latency off
    // every session start.
    const [, profile, memory] = await Promise.all([
      (async () => {
        const { AiCreativeEntitlementService } = await import(
          "../creative/entitlement.service"
        );
        return AiCreativeEntitlementService.assertCanRun(input.userId);
      })(),
      prisma.user.findUnique({
        where: { id: input.userId },
        select: {
          fullLegalName: true,
          locale: true,
          role: true,
          country: { select: { code: true, nameEn: true } },
          province: { select: { nameEn: true, nameAr: true, nameTr: true } },
          studentProfile: {
            select: {
              grade: true,
              educationalStage: {
                select: { nameEn: true, nameAr: true, nameTr: true },
              },
            },
          },
        },
      }),
      StudentMemoryService.getOrCreate(input.userId),
    ]);
    perf.mark("profileAndMemory");

    // The language the student explicitly selected to start this classroom
    // (e.g. the site's current UI locale) always wins over their stored
    // profile default — country still drives the regional accent below.
    // Normalize to ar|ku|tr|en so fallbacks and prompts never see ar-IQ etc.
    const language = normLang(input.language || profile?.locale || "en");
    const countryCode = profile?.country?.code || null;
    const provinceName =
      profile?.province?.nameEn ||
      profile?.province?.nameAr ||
      profile?.province?.nameTr ||
      null;
    const voice = resolveTeacherVoice({
      language,
      countryCode,
      provinceName,
    });

    const studentBlurb = [
      profile?.fullLegalName ? `Student: ${profile.fullLegalName}` : null,
      profile?.studentProfile?.educationalStage?.nameEn
        ? `Stage: ${profile.studentProfile.educationalStage.nameEn}`
        : null,
      profile?.studentProfile?.grade != null
        ? `Grade: ${profile.studentProfile.grade}`
        : null,
      countryCode ? `Country: ${countryCode}` : null,
      provinceName ? `Province: ${provinceName}` : null,
    ]
      .filter(Boolean)
      .join("; ");

    let documentIds = (input.documentIds || []).filter(Boolean);
    let materialNames: string[] = [];
    let curriculumOutline: string[] = [];
    let materialExcerpt = "";

    if (!documentIds.length) {
      const { AiExamService } = await import("../ai-exam.service");
      const materials = await AiExamService.listKbDocumentsForUser(input.userId);
      emit?.({
        type: "needs_materials",
        materials,
        pendingQuestion: input.question || "",
      });
      return {
        needsMaterialSelection: true as const,
        materials,
        pendingQuestion: input.question || "",
      };
    }

    const { AiExamService } = await import("../ai-exam.service");
    const { ExamGeneratorService } = await import("../exam-generator.service");
    const allowed = await AiExamService.assertDocumentsAllowed(
      input.userId,
      documentIds
    );
    documentIds = allowed;
    perf.mark("assertDocuments");

    // Doc names + chapter outline first so we can load the CURRENT lesson's
    // subject text (not a shuffled whole-PDF sample of page windows).
    const [docs, chaptersByDoc] = await Promise.all([
      prisma.kbDocument.findMany({
        where: { id: { in: allowed }, deletedAt: null },
        select: { id: true, fileName: true },
      }),
      Promise.all(
        allowed.map((docId) =>
          AiExamService.listDocumentChapters(input.userId, docId)
        )
      ),
    ]);
    materialNames = docs.map((d) => d.fileName).filter(Boolean);
    const chapterMeta: Array<{
      title: string;
      chunkFrom: number;
      chunkTo: number;
      pageStart: number | null;
      pageEnd: number | null;
    }> = [];
    for (const chapters of chaptersByDoc) {
      for (const c of chapters) {
        if (!c.title || c.title === "__all__") continue;
        // Reject cover/teacher/filename titles so the outline is real subjects.
        if (isWeakLessonTitle(c.title, materialNames)) continue;
        if (!curriculumOutline.includes(c.title)) {
          curriculumOutline.push(c.title);
          chapterMeta.push(c);
        }
      }
    }
    // If every heading was cover-meta, keep chapter bounds but rename titles
    // from the body text of each window.
    if (!curriculumOutline.length) {
      for (const chapters of chaptersByDoc) {
        for (const c of chapters) {
          if (!c.title || c.title === "__all__") continue;
          if (!chapterMeta.some((m) => m.chunkFrom === c.chunkFrom)) {
            chapterMeta.push(c);
          }
        }
      }
    }

    let openingChapter = chapterMeta[0] || null;
    // Always scope by page/chunk bounds — never heading-match a cover name.
    const material = await ExamGeneratorService.loadMaterialForDocuments({
      userId: input.userId,
      documentIds: allowed,
      chapterHeading:
        openingChapter && !isWeakLessonTitle(openingChapter.title, materialNames)
          ? openingChapter.title
          : null,
      chunkFrom: openingChapter?.chunkFrom ?? null,
      chunkTo: openingChapter?.chunkTo ?? null,
      pageFrom: openingChapter?.pageStart ?? null,
      pageTo: openingChapter?.pageEnd ?? null,
      ordered: true,
      question: input.question || "teach the subject from the material",
    });
    perf.mark("loadMaterial");
    materialExcerpt = cleanMaterialExcerpt(
      (material?.text?.trim() || "").slice(0, 9000),
      materialNames
    );
    // If bounds yielded almost nothing (bad page numbers), reload ordered body.
    if (materialExcerpt.length < 120) {
      const full = await ExamGeneratorService.loadMaterialForDocuments({
        userId: input.userId,
        documentIds: allowed,
        chapterHeading: null,
        ordered: true,
        question: "teach the subject from the material",
      });
      materialExcerpt = cleanMaterialExcerpt(
        (full?.text?.trim() || "").slice(0, 9000),
        materialNames
      );
    }

    // Rebuild outline titles from real excerpt concepts when needed.
    // Unit fallbacks follow the session speech language (not hard-coded Arabic).
    const speech = classroomSpeechLanguage({ language, countryCode, provinceName });
    const unitLabel = (n: number) =>
      speech === "ar"
        ? `الوحدة ${n}`
        : speech === "tr"
          ? `Ünite ${n}`
          : `Unit ${n}`;
    if (!curriculumOutline.length && chapterMeta.length) {
      for (let i = 0; i < chapterMeta.length; i++) {
        const c = chapterMeta[i]!;
        let title = topicFromExcerpt(
          materialExcerpt,
          unitLabel(i + 1),
          materialNames
        );
        if (i > 0) title = `${title} · ${i + 1}`;
        if (isWeakLessonTitle(title, materialNames)) title = unitLabel(i + 1);
        curriculumOutline.push(title);
        c.title = title;
      }
    } else if (!curriculumOutline.length) {
      const title = topicFromExcerpt(
        materialExcerpt,
        unitLabel(1),
        materialNames
      );
      curriculumOutline.push(
        isWeakLessonTitle(title, materialNames) ? unitLabel(1) : title
      );
    }

    let openingLesson = curriculumOutline[0] || null;
    if (openingLesson && isWeakLessonTitle(openingLesson, materialNames)) {
      openingLesson = topicFromExcerpt(
        materialExcerpt,
        unitLabel(1),
        materialNames
      );
      curriculumOutline[0] = openingLesson;
    }

    const state = emptyClassroomState(materialExcerpt);
    state.materialNames = materialNames;
    if (openingLesson) state.currentLessonName = openingLesson;
    if (
      !state.currentTopic &&
      openingLesson &&
      !isWeakLessonTitle(openingLesson, materialNames)
    ) {
      state.currentTopic = openingLesson.slice(0, 40);
    } else if (!state.currentTopic) {
      state.currentTopic = topicFromExcerpt(
        materialExcerpt,
        "فكرة الدرس",
        materialNames
      ).slice(0, 40);
    }

    const materialsKey = StudentMemoryService.materialsKey(documentIds);
    const restart = wantsRestartFromFirstLesson(input.question);
    let resumeLessonName: string | null = null;
    let completedLessonsForMaterial: string[] = [];
    let conceptMastery: ConceptMasteryMap = {};
    if (materialsKey) {
      // Independent long-term-memory reads — no need to serialize them.
      const [mastery, progress] = await Promise.all([
        StudentMemoryService.getConceptMastery(input.userId, materialsKey),
        restart
          ? Promise.resolve(null)
          : StudentMemoryService.getMaterialProgress(input.userId, materialsKey),
      ]);
      conceptMastery = mastery;
      if (!restart && progress) {
        completedLessonsForMaterial = progress.completedLessons || [];
        // Structured learning path: continue from the first curriculum lesson
        // NOT yet completed, never a random jump. Fall back to the last known
        // in-progress lesson (e.g. the whole outline is done — reinforcement
        // territory) when every lesson has already been completed.
        const nextUncompleted = curriculumOutline.find(
          (l) => !completedLessonsForMaterial.includes(l)
        );
        const candidate = nextUncompleted || progress.lessonName || null;
        if (
          candidate &&
          curriculumOutline.includes(candidate) &&
          candidate !== curriculumOutline[0]
        ) {
          state.currentLessonName = candidate;
          resumeLessonName = candidate;
        }
      }
    }
    // If we resumed a later lesson, reload that lesson's subject excerpt
    // so the teacher doesn't keep teaching from lesson 1's pages.
    if (
      resumeLessonName &&
      resumeLessonName !== openingLesson
    ) {
      try {
        state.materialExcerpt = await loadLessonMaterialExcerpt({
          userId: input.userId,
          documentIds: allowed,
          lessonName: resumeLessonName,
          materialNames,
          curriculumOutline,
        });
        if (!isWeakLessonTitle(resumeLessonName, materialNames)) {
          state.currentTopic = resumeLessonName.slice(0, 40);
        }
      } catch {
        /* keep opening excerpt */
      }
    }
    perf.mark("longTermMemory");
    state.materialCompletedLessons = completedLessonsForMaterial;
    const { mastered: masteredTopics, weak: weakTopics } = masteryLists(conceptMastery);
    state.masteredTopics = masteredTopics;
    state.weakTopics = weakTopics;
    // Cache the slow-changing part of long-term memory once, here, so every
    // later beat/turn in THIS session skips the StudentAiMemory round trip
    // entirely (materialCompletedLessons/masteredTopics/weakTopics above are
    // already tracked live in `state` and need no re-fetch either).
    // Never inject a conflicting "Usually taught in: X" when the student
    // just started a session in a different language — that caused bilingual
    // / wrong-language opening beats.
    const sessionLang = language;
    const storedLang = memory.preferredLanguage
      ? normLang(memory.preferredLanguage)
      : null;
    const preferredForPrompt =
      storedLang && storedLang === sessionLang ? storedLang : sessionLang;
    state.studentPreferenceBlurb = [
      StudentMemoryService.toPromptBlurb(memory),
      `Session language: ${sessionLang}`,
    ]
      .filter(Boolean)
      .join("; ");

    const memoryBlurb = [
      StudentMemoryService.toPromptBlurb(memory),
      StudentMemoryService.classroomMemoryBlurb({
        preferredLanguage: preferredForPrompt,
        preferredStyle: memory.preferredStyle,
        learningSpeed: memory.learningSpeed,
        completedLessons: completedLessonsForMaterial,
        conceptMastery,
      }),
    ]
      .filter(Boolean)
      .join("; ");
    void StudentMemoryService.savePreferredLanguage(input.userId, language);
    perf.mark("prepareState");
    emit?.({
      type: "status",
      presence: "thinking",
      message: "Generating explanation…",
    });

    // Create the session row FIRST so the client can bind a sessionId (and
    // start listening for speak/board) before the LLM finishes — then stream
    // the opening beat with progressive partials. When no onEvent is wired
    // (non-streaming callers), we still overlap the row insert with the LLM
    // call via Promise.all below for the same wall-clock win as before.
    const createRow = () =>
      prisma.aiClassroomSession.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId || null,
          documentIds,
          status: "LIVE",
          locale: language.slice(0, 8),
          countryCode,
          provinceName,
          materialNames,
          curriculumOutline: curriculumOutline as Prisma.InputJsonValue,
          state: state as unknown as Prisma.InputJsonValue,
          beatIndex: 0,
        },
      });

    const generateOpen = (onPartial?: Parameters<typeof this.generateBeat>[0]["onPartial"]) =>
      this.generateBeat({
        userId: input.userId,
        language,
        countryCode,
        provinceName,
        materialNames,
        curriculumOutline,
        studentBlurb,
        memoryBlurb,
        state,
        mode: "open",
        question: input.question || undefined,
        resumeLessonName,
        onPartial,
      });

    let row: Awaited<ReturnType<typeof createRow>>;
    let beat: ClassroomBeat;
    if (emit) {
      row = await createRow();
      emit({
        type: "session",
        session: toPublic(
          { ...row, beatIndex: 0, state },
          voice.speechLocale,
          voice.accent
        ),
      });
      beat = await generateOpen((partial) => {
        if (partial.speak) {
          emit({
            type: "speak",
            index: partial.speak.index,
            text: partial.speak.text,
            emotion: partial.emotion,
            pace: partial.pace,
          });
        }
        if (partial.board?.length) {
          emit({ type: "board", actions: partial.board });
        }
      });
    } else {
      [row, beat] = await Promise.all([createRow(), generateOpen()]);
    }
    perf.mark("createRowAndLlm");

    const nextState = mergeState(state, beat, undefined, "open");
    applyLongTermMemory(input.userId, materialsKey, state, beat, nextState);
    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
        beatIndex: 1,
      },
    });

    if (materialsKey) {
      void StudentMemoryService.saveMaterialProgress(input.userId, materialsKey, {
        lessonName: nextState.currentLessonName,
        lessonIndex: curriculumOutline.indexOf(nextState.currentLessonName || ""),
        materialNames,
        curriculumOutline,
        understanding: nextState.understanding,
        confidence: nextState.confidence,
        learningSpeed: nextState.learningSpeed,
        mistakes: nextState.mistakes,
      });
    }
    perf.mark("persist");
    perf.finish({ sessionId: row.id, docs: documentIds.length });

    const publicSession = toPublic(
      { ...row, beatIndex: 1, state: nextState },
      voice.speechLocale,
      voice.accent
    );
    emit?.({ type: "complete", beat, session: publicSession });

    return {
      needsMaterialSelection: false as const,
      session: publicSession,
      beat,
    };
  }

  static async nextBeat(input: {
    userId: string;
    sessionId: string;
    onEvent?: (event: ClassroomStreamEvent) => void;
  }) {
    const emit = input.onEvent;
    const perf = new ClassroomPerfTimer("beat");
    emit?.({
      type: "status",
      presence: "thinking",
      message: "Preparing next step…",
    });
    const row = await this.requireLiveSession(input.userId, input.sessionId);
    perf.mark("loadSession");
    const state = row.state as unknown as ClassroomSessionState;
    const curriculumOutline = asStringArray(row.curriculumOutline);
    const materialsKey = StudentMemoryService.materialsKey(row.documentIds);
    // No StudentAiMemory round trip here — the static preference blurb was
    // cached on `state` once at session open, and the mastered/weak/
    // completed lists live inside `state` itself too, carried forward beat
    // to beat. This is what keeps every beat's latency down to just the LLM
    // call instead of an extra DB read on top of it.
    const memoryBlurb = state.studentPreferenceBlurb || "";

    const beat = await this.generateBeat({
      userId: input.userId,
      language: row.locale,
      countryCode: row.countryCode,
      provinceName: row.provinceName,
      materialNames: row.materialNames,
      curriculumOutline,
      studentBlurb: "",
      memoryBlurb,
      state,
      mode: "next",
      onPartial: emit
        ? (partial) => {
            if (partial.speak) {
              emit({
                type: "speak",
                index: partial.speak.index,
                text: partial.speak.text,
                emotion: partial.emotion,
                pace: partial.pace,
              });
            }
            if (partial.board?.length) {
              emit({ type: "board", actions: partial.board });
            }
          }
        : undefined,
    });
    perf.mark("llm");

    const nextState = mergeState(state, beat, undefined, "next");
    if (
      nextState.currentLessonName &&
      nextState.currentLessonName !== state.currentLessonName &&
      Array.isArray(row.documentIds) &&
      row.documentIds.length
    ) {
      try {
        nextState.materialExcerpt = await loadLessonMaterialExcerpt({
          userId: input.userId,
          documentIds: row.documentIds,
          lessonName: nextState.currentLessonName,
          materialNames: nextState.materialNames || row.materialNames || [],
          curriculumOutline: asStringArray(row.curriculumOutline),
        });
        const names = nextState.materialNames || row.materialNames || [];
        if (!isWeakLessonTitle(nextState.currentLessonName, names)) {
          nextState.currentTopic = nextState.currentLessonName.slice(0, 40);
        }
      } catch {
        /* keep previous excerpt */
      }
    }
    applyLongTermMemory(input.userId, materialsKey, state, beat, nextState);
    const beatIndex = row.beatIndex + 1;
    const ended = Boolean(beat.sessionComplete) || beatIndex > 150;
    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
        beatIndex,
        status: ended ? "ENDED" : "LIVE",
        endedAt: ended ? new Date() : null,
      },
    });
    perf.mark("persist");
    perf.finish({ sessionId: input.sessionId, stage: nextState.lessonStage });

    if (materialsKey && nextState.currentLessonName) {
      void StudentMemoryService.saveMaterialProgress(input.userId, materialsKey, {
        lessonName: nextState.currentLessonName,
        lessonIndex: curriculumOutline.indexOf(nextState.currentLessonName),
        materialNames: row.materialNames,
        curriculumOutline,
        understanding: nextState.understanding,
        confidence: nextState.confidence,
        learningSpeed: nextState.learningSpeed,
        mistakes: nextState.mistakes,
      });
    }
    if (ended) {
      void this.finalizeSessionMemory(input.userId, row, nextState);
    }

    const voice = resolveTeacherVoice({
      language: row.locale,
      countryCode: row.countryCode,
      provinceName: row.provinceName,
    });

    const publicSession = toPublic(
      {
        ...row,
        beatIndex,
        state: nextState,
        status: ended ? "ENDED" : "LIVE",
      },
      voice.speechLocale,
      voice.accent
    );
    emit?.({ type: "complete", beat, session: publicSession });

    return {
      session: publicSession,
      beat,
    };
  }

  static async studentTurn(input: {
    userId: string;
    sessionId: string;
    transcript?: string;
    noAnswer?: boolean;
    signals?: {
      frustration?: number;
      confidence?: number;
      confusion?: number;
    };
    onEvent?: (event: ClassroomStreamEvent) => void;
  }) {
    const emit = input.onEvent;
    const perf = new ClassroomPerfTimer("turn");
    const silence = Boolean(input.noAnswer);
    emit?.({
      type: "status",
      presence: "thinking",
      message: silence
        ? "Waiting for your answer…"
        : "Analyzing your answer…",
    });
    const transcript =
      sanitizeClassroomPlainText(input.transcript || "", 280) ||
      (input.transcript || "").trim();
    if (!silence && !transcript) throw new Error("Empty transcript");

    const row = await this.requireLiveSession(input.userId, input.sessionId);
    perf.mark("loadSession");
    const state = {
      ...emptyClassroomState(""),
      ...(row.state as unknown as ClassroomSessionState),
    };
    if (typeof input.signals?.confusion === "number" && input.signals.confusion > 0.55) {
      state.understanding = Math.max(0.15, state.understanding - 0.12);
      state.emotionalState = "confused";
    }
    if (typeof input.signals?.frustration === "number" && input.signals.frustration > 0.55) {
      state.emotionalState = "frustrated";
      state.learningSpeed = "slow";
      state.challengeLevel = "gentle";
    }
    if (typeof input.signals?.confidence === "number" && input.signals.confidence > 0.65) {
      state.confidence = clamp01(input.signals.confidence);
      state.emotionalState = "energetic";
    }

    const curriculumOutline = asStringArray(row.curriculumOutline);
    // Cached at session open — see nextBeat() for why this avoids a DB read.
    const memoryBlurb = state.studentPreferenceBlurb || "";

    const beat = await this.generateBeat({
      userId: input.userId,
      language: row.locale,
      countryCode: row.countryCode,
      provinceName: row.provinceName,
      materialNames: row.materialNames,
      curriculumOutline,
      studentBlurb: "",
      memoryBlurb,
      state,
      mode: silence ? "silence" : "react",
      studentTranscript: silence ? undefined : transcript,
      onPartial: emit
        ? (partial) => {
            if (partial.speak) {
              emit({
                type: "speak",
                index: partial.speak.index,
                text: partial.speak.text,
                emotion: partial.emotion,
                pace: partial.pace,
              });
            }
            if (partial.board?.length) {
              emit({ type: "board", actions: partial.board });
            }
          }
        : undefined,
    });
    perf.mark("llm");

    const nextState = mergeState(
      state,
      beat,
      silence ? undefined : transcript,
      silence ? "silence" : "react"
    );
    if (
      nextState.currentLessonName &&
      nextState.currentLessonName !== state.currentLessonName &&
      Array.isArray(row.documentIds) &&
      row.documentIds.length
    ) {
      try {
        nextState.materialExcerpt = await loadLessonMaterialExcerpt({
          userId: input.userId,
          documentIds: row.documentIds,
          lessonName: nextState.currentLessonName,
          materialNames: nextState.materialNames || row.materialNames || [],
          curriculumOutline: asStringArray(row.curriculumOutline),
        });
        const names = nextState.materialNames || row.materialNames || [];
        if (!isWeakLessonTitle(nextState.currentLessonName, names)) {
          nextState.currentTopic = nextState.currentLessonName.slice(0, 40);
        }
      } catch {
        /* keep previous excerpt */
      }
    }
    const materialsKey = StudentMemoryService.materialsKey(row.documentIds);
    applyLongTermMemory(input.userId, materialsKey, state, beat, nextState);
    // Silence only re-arms a pending check inside check/quiz stages. Outside
    // those stages a "no answer" timeout must not invent a question and trap
    // the lesson in re-ask loops with an empty board.
    const silenceStage = nextState.lessonStage || state.lessonStage || "greeting";
    if (
      silence &&
      (silenceStage === "check_understanding" || silenceStage === "mini_quiz")
    ) {
      nextState.pendingAttempts = (nextState.pendingAttempts || 0) + 1;
      nextState.awaitingCorrectAnswer = true;
      if (!nextState.pendingQuestion) {
        nextState.pendingQuestion =
          beat.askStudent || state.pendingQuestion || state.lastAskStudent;
      }
    }
    const beatIndex = row.beatIndex + 1;
    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
        beatIndex,
        status: "LIVE",
      },
    });
    perf.mark("persist");
    perf.finish({
      sessionId: input.sessionId,
      mode: silence ? "silence" : "react",
      stage: nextState.lessonStage,
    });

    if (!silence && transcript) {
      void StudentMemoryService.recordQuestion(input.userId, transcript);
    }

    if (materialsKey && nextState.currentLessonName) {
      void StudentMemoryService.saveMaterialProgress(input.userId, materialsKey, {
        lessonName: nextState.currentLessonName,
        lessonIndex: curriculumOutline.indexOf(nextState.currentLessonName),
        materialNames: row.materialNames,
        curriculumOutline,
        understanding: nextState.understanding,
        confidence: nextState.confidence,
        learningSpeed: nextState.learningSpeed,
        mistakes: nextState.mistakes,
      });
    }

    const voice = resolveTeacherVoice({
      language: row.locale,
      countryCode: row.countryCode,
      provinceName: row.provinceName,
    });

    const publicSession = toPublic(
      { ...row, beatIndex, state: nextState, status: "LIVE" },
      voice.speechLocale,
      voice.accent
    );
    emit?.({ type: "complete", beat, session: publicSession });

    return {
      session: publicSession,
      beat,
    };
  }

  static async endSession(input: { userId: string; sessionId: string }) {
    const row = await prisma.aiClassroomSession.findFirst({
      where: { id: input.sessionId, userId: input.userId },
    });
    if (!row) throw new Error("Session not found");
    const state = row.state as unknown as ClassroomSessionState;
    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: { status: "ENDED", endedAt: new Date() },
    });

    await this.finalizeSessionMemory(input.userId, row, state);

    return {
      ok: true,
      summary:
        state.spokenHistory.slice(-3).join(" ") ||
        "Classroom session completed.",
      lessonName: state.currentLessonName,
    };
  }

  /**
   * Writes light long-term memory signals (completed lessons, style, pace)
   * and refreshes the AI teacher's written evaluation for this material —
   * called whenever a session ends, whether the student closes the
   * classroom or the AI naturally completes the material.
   */
  private static async finalizeSessionMemory(
    userId: string,
    row: {
      documentIds: string[];
      materialNames: string[];
      curriculumOutline: unknown;
      locale: string;
    },
    state: ClassroomSessionState
  ) {
    try {
      const mem = await StudentMemoryService.getOrCreate(userId);
      const completed = [...(mem.completedLessons || [])];
      if (state.currentLessonName && !completed.includes(state.currentLessonName)) {
        completed.unshift(state.currentLessonName);
      }
      await prisma.studentAiMemory.update({
        where: { userId },
        data: {
          completedLessons: completed.slice(0, 40),
          preferredStyle: state.teachingStyle || mem.preferredStyle,
          learningSpeed: state.learningSpeed || mem.learningSpeed,
        },
      });
    } catch {
      /* ignore memory writeback failures */
    }

    // Session just ended — always recompute regardless of the throttle so
    // the scorecard reflects this session's final state immediately.
    void SubjectAssessmentService.recomputeFromDocuments(userId, row.documentIds).catch(() => {});

    const materialsKey = StudentMemoryService.materialsKey(row.documentIds);
    if (!materialsKey) return;
    // A session that never produced a single teaching beat has nothing to
    // evaluate yet — avoid a misleading "0% understanding" report card.
    if (!state.currentLessonName && !state.spokenHistory.length) return;

    try {
      const curriculumOutline = asStringArray(row.curriculumOutline);
      const evaluation = await this.generateEvaluation({
        userId,
        language: row.locale,
        materialNames: row.materialNames || [],
        curriculumOutline,
        state,
      });
      await StudentMemoryService.saveMaterialEvaluation(userId, materialsKey, evaluation);
    } catch {
      /* evaluation is best-effort; progress tracking already succeeded */
    }
  }

  /** Ask the AI teacher for a short, honest written evaluation of the
   *  student's performance on this material so far. Falls back to a
   *  deterministic evaluation if the AI call fails. */
  private static async generateEvaluation(input: {
    userId: string;
    language: string;
    materialNames: string[];
    curriculumOutline: string[];
    state: ClassroomSessionState;
  }): Promise<MaterialEvaluation> {
    const { state, curriculumOutline } = input;
    const scorePercent = Math.round(clamp01(state.understanding) * 100);
    const lessonIdx = state.currentLessonName
      ? curriculumOutline.indexOf(state.currentLessonName)
      : -1;
    const lessonsCompleted = Math.max(0, lessonIdx);
    const totalLessons = curriculumOutline.length || Math.max(lessonsCompleted + 1, 1);

    const fallback = fallbackEvaluationText(input.language, state.understanding);
    let summary = fallback.summary;
    let strengths = fallback.strengths;
    let weaknesses = fallback.weaknesses;
    let recommendation = fallback.recommendation;

    const system = [
      "You are an experienced, warm classroom teacher writing a short private evaluation note for ONE student about ONE study material, right after a live tutoring session.",
      'Return ONLY valid JSON (no markdown): {"summary":"...","strengths":["..."],"weaknesses":["..."],"recommendation":"..."}',
      "summary: 2-3 warm, honest sentences written directly to the student, in their language.",
      "strengths: 1-3 short phrases describing what they did well. Empty array if genuinely none yet.",
      "weaknesses: 0-3 short phrases describing what still needs practice.",
      "recommendation: ONE short, actionable next step.",
      `Write everything in this language/locale: ${input.language}.`,
    ].join("\n");

    const userContent = [
      input.materialNames.length ? `Material: ${input.materialNames.join(", ")}` : "",
      curriculumOutline.length
        ? `Progress: lesson ${lessonsCompleted + 1} of ${totalLessons} ("${
            state.currentLessonName || curriculumOutline[0]
          }")`
        : "",
      `Understanding score: ${scorePercent}%`,
      `Confidence score: ${Math.round(clamp01(state.confidence) * 100)}%`,
      `Learning pace: ${state.learningSpeed}`,
      state.mistakes.length
        ? `Mistakes noticed during the session: ${state.mistakes.slice(-6).join("; ")}`
        : "No notable mistakes this session.",
      state.spokenHistory.length
        ? `Recent teaching context: ${state.spokenHistory.slice(-4).join(" ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const result = await AiProviderService.chat(
        "TEACHING_ASSISTANT",
        [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        input.userId,
        { temperature: 0.4 }
      );
      const jsonText = extractJsonObject(result.text);
      if (jsonText) {
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        const s = sanitizeClassroomPlainText(parsed.summary, 400);
        if (s) summary = s;
        if (Array.isArray(parsed.strengths)) {
          const arr = parsed.strengths
            .map((x) => sanitizeClassroomPlainText(x, 80))
            .filter(Boolean) as string[];
          if (arr.length) strengths = arr.slice(0, 3);
        }
        if (Array.isArray(parsed.weaknesses)) {
          weaknesses = (
            parsed.weaknesses
              .map((x) => sanitizeClassroomPlainText(x, 80))
              .filter(Boolean) as string[]
          ).slice(0, 3);
        }
        const rec = sanitizeClassroomPlainText(parsed.recommendation, 160);
        if (rec) recommendation = rec;
      }
    } catch {
      /* keep deterministic fallback */
    }

    return {
      scorePercent,
      summary,
      strengths,
      weaknesses,
      recommendation,
      lessonsCompleted: lessonsCompleted + 1,
      totalLessons,
      generatedAt: new Date().toISOString(),
    };
  }

  /** All per-material evaluations for the student's "My Evaluations" view. */
  static async listEvaluations(userId: string) {
    const entries = await StudentMemoryService.listMaterialEvaluations(userId);
    return entries.map((e) => ({
      materialsKey: e.materialsKey,
      materialNames: e.materialNames || [],
      lessonName: e.lessonName || null,
      lessonIndex: e.lessonIndex,
      totalLessons:
        e.evaluation?.totalLessons ?? (e.curriculumOutline || []).length ?? 0,
      understanding: typeof e.understanding === "number" ? e.understanding : null,
      confidence: typeof e.confidence === "number" ? e.confidence : null,
      updatedAt: e.updatedAt,
      evaluation: e.evaluation || null,
      completedLessonsCount: e.completedLessons?.length || 0,
      masteredCount: e.masteredCount || 0,
      weakCount: e.weakCount || 0,
    }));
  }

  private static async requireLiveSession(userId: string, sessionId: string) {
    const row = await prisma.aiClassroomSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!row) throw new Error("Session not found");
    if (row.status === "ENDED") throw new Error("Session already ended");
    return row;
  }

  /**
   * Map raw board cue objects from a still-streaming JSON fragment into the
   * same shape finalizeBeat/normalizeBoardActions expect — so the client can
   * start drawing the instant each cue finishes in the stream.
   */
  private static mapBoardRaw(boardRaw: Record<string, unknown>[]): ClassroomBoardAction[] {
    return boardRaw
      .map((r, i) => {
        const action = String(r.action || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_");
        if (!action) return null;
        const parameters =
          r.parameters && typeof r.parameters === "object" && !Array.isArray(r.parameters)
            ? { ...(r.parameters as Record<string, unknown>) }
            : {};
        if ("text" in parameters) {
          parameters.text = sanitizeClassroomPlainText(parameters.text, 40);
        }
        return {
          time: Math.max(0, Number(r.time) || i * 350),
          action,
          parameters,
        };
      })
      .filter(Boolean) as ClassroomBoardAction[];
  }

  private static async generateBeat(input: {
    userId: string;
    language: string;
    countryCode: string | null;
    provinceName: string | null;
    materialNames: string[];
    curriculumOutline: string[];
    studentBlurb: string;
    memoryBlurb: string;
    state: ClassroomSessionState;
    mode: "open" | "next" | "react" | "silence";
    studentTranscript?: string;
    question?: string;
    resumeLessonName?: string | null;
    /**
     * Fired as soon as a complete speak line or board cue appears in the
     * still-growing model stream — this is what makes the classroom feel
     * live instead of waiting for the whole JSON beat to finish.
     */
    onPartial?: (partial: {
      speak?: { index: number; text: string };
      board?: ClassroomBoardAction[];
      emotion?: string | null;
      pace?: string | null;
    }) => void;
  }): Promise<ClassroomBeat> {
    const system = buildClassroomBeatPrompt({
      language: input.language,
      countryCode: input.countryCode,
      provinceName: input.provinceName,
      materialNames: input.materialNames,
      curriculumOutline: input.curriculumOutline,
      studentBlurb: input.studentBlurb,
      memoryBlurb: input.memoryBlurb,
      state: input.state,
      mode: input.mode,
      studentTranscript: input.studentTranscript,
      resumeLessonName: input.resumeLessonName,
    });

    const langLock = classroomLanguageLock({
      language: input.language,
      countryCode: input.countryCode,
      provinceName: input.provinceName,
    });
    const task =
      input.mode === "open"
        ? `Open the live classroom. Student request: ${
            input.question ||
            (input.resumeLessonName
              ? `Continue teaching from "${input.resumeLessonName}" where the student left off — do not restart from lesson 1.`
              : "Teach my selected material from the first lesson to the last.")
          }`
        : input.mode === "react"
          ? `Student spoke — answer immediately: ${input.studentTranscript}`
          : input.mode === "silence"
            ? "Student did not answer. Repeat the pending check question by voice now."
            : "Continue the live classroom with the next natural teaching beat.";
    const userContent = `${langLock}\n\n${task}\n\nReturn ONLY the JSON beat. speak[] and board text MUST follow LANGUAGE LOCK.`;

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ];

    const fallbackMode =
      input.mode === "silence" ? "react" : input.mode === "react" ? "react" : input.mode === "open" ? "open" : "next";
    const temperature = input.mode === "react" || input.mode === "silence" ? 0.35 : 0.45;
    // Beats are always a couple of short sentences + a few board actions, but
    // Arabic with full diacritics (required for accurate pronunciation — see
    // accentInstruction) can run notably longer per line than plain text, and
    // REACT beats often both react AND teach the next micro-idea. Too tight a
    // cap truncates the JSON mid-response, parseBeat then fails, and the
    // student hears the same generic fallback question over and over — worse
    // than a slightly slower real response. Keep a real but generous ceiling.
    // Arabic (+ KU→AR) needs more room for diacritics; keep non-Arabic tighter.
    const speechLang = classroomSpeechLanguage({
      language: input.language,
      countryCode: input.countryCode,
      provinceName: input.provinceName,
    });
    const maxTokensExact =
      speechLang === "ar"
        ? input.mode === "open"
          ? 1400
          : 1200
        : input.mode === "open"
          ? 1000
          : 900;

    // CRITICAL ARCHITECTURE RULE: never block the classroom waiting on a
    // slow/stuck model. Every attempt streams (falling back gracefully to a
    // single non-streamed call when the resolved provider doesn't support
    // streaming — see AiProviderService.chatStream), is cut short the
    // instant a complete JSON beat appears in the stream (skips whatever
    // trailing tokens the model would otherwise still emit before its own
    // stop token), and is bounded by a hard deadline so a stalled provider
    // degrades to the graceful fallback beat below instead of freezing the
    // lesson for tens of seconds.
    const runOnce = async (tokenCap: number, deadlineMs: number): Promise<string | null> => {
      const cutoff = { timedOut: false, captured: null as string | null };
      let emittedSpeak = 0;
      let emittedBoard = 0;
      let lastEmotion: string | null = null;
      let lastPace: string | null = null;
      const timer = setTimeout(() => {
        cutoff.timedOut = true;
      }, deadlineMs);
      try {
        const result = await AiProviderService.chatStream(
          "TEACHING_ASSISTANT",
          messages,
          input.userId,
          { temperature, maxTokensExact: tokenCap },
          (_delta, fullText) => {
            if (cutoff.timedOut) return true;
            const progressive = extractProgressiveBeatFields(fullText);
            if (input.onPartial) {
              if (progressive.emotion) lastEmotion = progressive.emotion;
              if (progressive.pace) lastPace = progressive.pace;
              const stageAllowsLiveAsk =
                input.state.lessonStage === "check_understanding" ||
                input.state.lessonStage === "mini_quiz";
              while (emittedSpeak < progressive.speak.length) {
                const text = sanitizeClassroomPlainText(
                  progressive.speak[emittedSpeak],
                  220
                );
                // Don't stream premature quiz/ready probes during teaching —
                // finalizeBeat will replace them with real teaching lines.
                const premature =
                  !stageAllowsLiveAsk &&
                  !!text &&
                  PREMATURE_UNDERSTANDING_PATTERNS.some((re) => re.test(text));
                if (text && !premature) {
                  input.onPartial({
                    speak: { index: emittedSpeak, text },
                    emotion: lastEmotion,
                    pace: lastPace,
                  });
                }
                emittedSpeak++;
              }
              if (progressive.boardRaw.length > emittedBoard) {
                const mapped = this.mapBoardRaw(
                  progressive.boardRaw.slice(emittedBoard)
                );
                emittedBoard = progressive.boardRaw.length;
                if (mapped.length) {
                  input.onPartial({
                    board: mapped,
                    emotion: lastEmotion,
                    pace: lastPace,
                  });
                }
              }
            }
            const obj = progressive.completeJson || findBalancedJsonObject(fullText);
            if (obj) {
              cutoff.captured = obj;
              return true;
            }
            return false;
          }
        );
        return cutoff.captured || result.text;
      } catch {
        return cutoff.captured;
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      // Deadlines here are a safety net, not the expected case — real beats
      // (1-2 short sentences + a few board actions) normally finish in a
      // couple of seconds and early-stop the instant the JSON closes, well
      // under these ceilings. They exist so a genuinely stuck/overloaded
      // provider degrades to a graceful fallback beat in ~12-27s instead of
      // silently riding all the way to the client's 55s timeout and
      // surfacing a hard "Request timed out" error.
      let text = await runOnce(maxTokensExact, 12000);
      let parsed = text ? parseBeat(text) : null;
      if (!parsed) {
        // Likely truncated output (or the deadline fired) — retry once with
        // a much bigger ceiling and a slightly longer deadline before
        // gracefully falling back to a generic line.
        text = await runOnce(maxTokensExact * 2, 15000);
        parsed = text ? parseBeat(text) : null;
      }
      const beat =
        parsed ||
        fallbackBeat(
          input.language,
          fallbackMode,
          input.state.currentLessonName || input.curriculumOutline[0] || null,
          Date.now(),
          input.state.lessonStage,
          input.countryCode,
          input.provinceName
        );
      return finalizeBeat(beat, input.state, input.language, input.mode);
    } catch {
      return finalizeBeat(
        fallbackBeat(
          input.language,
          fallbackMode,
          input.state.currentLessonName || input.curriculumOutline[0] || null,
          Date.now(),
          input.state.lessonStage,
          input.countryCode,
          input.provinceName
        ),
        input.state,
        input.language,
        input.mode
      );
    }
  }
}
