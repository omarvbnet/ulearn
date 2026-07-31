import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { AiProviderService } from "../ai-provider.service";
import { StudentMemoryService, type MaterialEvaluation } from "../student-memory.service";
import { resolveTeacherVoice } from "../voice-accent";
import { sanitizeClassroomPlainText } from "../ai-teacher-prompt";
import type { ChatMessage } from "../types";
import { normalizeBoardActions } from "./board-layout";
import { buildClassroomBeatPrompt } from "./classroom-prompts";
import {
  emptyClassroomState,
  type ClassroomBeat,
  type ClassroomBoardAction,
  type ClassroomEmotion,
  type ClassroomPace,
  type ClassroomSessionPublic,
  type ClassroomSessionState,
} from "./types";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
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

    return {
      speak: speak.slice(0, 2),
      board: board.slice(0, 3),
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
      ].includes(emotion)
        ? emotion
        : "calm",
      pace: ["slow", "normal", "brisk"].includes(pace) ? pace : "normal",
      lessonName: o.lessonName
        ? sanitizeClassroomPlainText(o.lessonName, 80)
        : null,
      sessionComplete: Boolean(o.sessionComplete),
      answerCorrect,
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
const MIN_EXPLAIN_BEATS = 2;

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

  let speak = stripRepeatedIntro(
    [...(beat.speak || [])].filter(Boolean),
    state,
    mode
  );
  let board = [...(beat.board || [])];

  // Wrong answer must always continue with voice + board re-explanation.
  if (beat.answerCorrect === false) {
    if (!speak.length) {
      speak = [
        ar
          ? "نفس الفكرة مرة ثانية بهدوء."
          : tr
            ? "Aynı fikri sakin sakin tekrar edelim."
            : "Same idea again, slowly and clearly.",
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
        ar
          ? "لنكمل الخطوة التالية."
          : tr
            ? "Şimdi sonraki adıma geçelim."
            : "Let’s continue with the next step.",
      ];
    }
  }

  const layout = normalizeBoardActions(board, {
    rtl,
    cursorY: state.boardCursorY || 160,
  });
  let ask =
    beat.askStudent ||
    (speak.length && /[?؟]$/.test(speak[speak.length - 1] || "")
      ? speak[speak.length - 1]
      : null);
  // Don't let the teacher quiz the student until the current idea has been
  // taught deeply enough (definition + a real-life example, across a few
  // beats) — a fresh check on an idea introduced just now feels rushed.
  // Re-asking a still-pending question (silence/wrong-answer flows) is
  // always allowed since that isn't a NEW check.
  const introducingNewCheck =
    ask && !state.awaitingCorrectAnswer && (mode === "next" || mode === "react");
  if (introducingNewCheck && (state.explainBeats || 0) < MIN_EXPLAIN_BEATS) {
    ask = null;
  }
  // Ensure check questions are spoken aloud.
  if (ask && !speak.some((s) => s.includes(ask!.slice(0, 12)))) {
    speak.push(ask);
  }
  return {
    ...beat,
    speak: speak.slice(0, 3),
    board: layout.actions,
    askStudent: ask,
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

function fallbackBeat(
  language: string,
  mode: "open" | "next" | "react",
  lessonName?: string | null
): ClassroomBeat {
  const ar = language === "ar" || language === "ku";
  const tr = language === "tr";
  if (mode === "react") {
    return {
      speak: [
        ar
          ? "سؤال ممتاز. دعنا نوضّح الفكرة على السبورة، ثم نكمل معاً."
          : tr
            ? "Harika soru. Tahtada netleştirelim, sonra birlikte devam edelim."
            : "Excellent question. Let’s clarify it on the board, then continue together.",
      ],
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
      askStudent: ar
        ? "ما الذي فهمته الآن؟"
        : tr
          ? "Şimdi ne anladın?"
          : "What do you understand now?",
      waitForStudentMs: 4800,
      emotion: "encouraging",
      pace: "slow",
      lessonName: lessonName || null,
    };
  }
  return {
    speak: [
      ar
        ? "مرحباً. لنبدأ درسنا معاً بهدوء ووضوح."
        : tr
          ? "Merhaba. Dersimize sakin ve net bir şekilde başlayalım."
          : "Welcome. Let’s begin our lesson together — clear and calm.",
      lessonName
        ? ar
          ? `موضوعنا الآن: ${lessonName}`
          : tr
            ? `Bugünkü konumuz: ${lessonName}`
            : `Our focus now: ${lessonName}`
        : ar
          ? "سأشرح على السبورة خطوة بخطوة."
          : tr
            ? "Tahtada adım adım anlatacağım."
            : "I’ll explain step by step on the board.",
    ].filter(Boolean) as string[],
    board: [
      {
        time: 0,
        action: "write_text",
        parameters: {
          text: lessonName || (ar ? "درس اليوم" : tr ? "Bugünün dersi" : "Today"),
          x: ar ? 1780 : 120,
          y: 120,
          size: 58,
          color: "blue",
          align: ar ? "right" : "left",
        },
      },
    ],
    askStudent: ar
      ? "هل أنت مستعد؟"
      : tr
        ? "Hazır mısın?"
        : "Are you ready?",
    waitForStudentMs: 4500,
    emotion: "encouraging",
    pace: "normal",
    lessonName: lessonName || null,
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
  if (typeof patch.attention === "number")
    next.attention = clamp01(patch.attention, next.attention);
  if (typeof patch.confidence === "number")
    next.confidence = clamp01(patch.confidence, next.confidence);
  if (patch.learningSpeed === "slow" || patch.learningSpeed === "normal" || patch.learningSpeed === "fast") {
    next.learningSpeed = patch.learningSpeed;
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
      next.emotionalState = "patient";
      next.learningSpeed = "slow";
    }
  }

  if (studentTranscript?.trim()) {
    next.studentQuestions = [...next.studentQuestions, studentTranscript.trim()].slice(
      -16
    );
  }
  return next;
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
  }) {
    await (
      await import("../creative/entitlement.service")
    ).AiCreativeEntitlementService.assertCanRun(input.userId);

    const profile = await prisma.user.findUnique({
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
    });

    // The language the student explicitly selected to start this classroom
    // (e.g. the site's current UI locale) always wins over their stored
    // profile default — country still drives the regional accent below.
    const language = (input.language || profile?.locale || "en").toString();
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

    const memory = await StudentMemoryService.getOrCreate(input.userId);
    const memoryBlurb = StudentMemoryService.toPromptBlurb(memory);
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
    const docs = await prisma.kbDocument.findMany({
      where: { id: { in: allowed }, deletedAt: null },
      select: { id: true, fileName: true },
    });
    materialNames = docs.map((d) => d.fileName).filter(Boolean);

    for (const docId of allowed) {
      const chapters = await AiExamService.listDocumentChapters(
        input.userId,
        docId
      );
      for (const c of chapters) {
        if (!c.title || c.title === "__all__") continue;
        if (!curriculumOutline.includes(c.title)) curriculumOutline.push(c.title);
      }
    }

    const material = await ExamGeneratorService.loadMaterialForDocuments({
      userId: input.userId,
      documentIds: allowed,
      chapterHeading: "__all__",
      question: input.question || undefined,
    });
    materialExcerpt = (material?.text?.trim() || "").slice(0, 6500);

    const state = emptyClassroomState(materialExcerpt);
    if (curriculumOutline[0]) state.currentLessonName = curriculumOutline[0];

    const materialsKey = StudentMemoryService.materialsKey(documentIds);
    const restart = wantsRestartFromFirstLesson(input.question);
    let resumeLessonName: string | null = null;
    if (!restart && materialsKey) {
      const progress = await StudentMemoryService.getMaterialProgress(
        input.userId,
        materialsKey
      );
      if (
        progress?.lessonName &&
        curriculumOutline.includes(progress.lessonName) &&
        progress.lessonName !== curriculumOutline[0]
      ) {
        state.currentLessonName = progress.lessonName;
        resumeLessonName = progress.lessonName;
      }
    }

    const row = await prisma.aiClassroomSession.create({
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

    const beat = await this.generateBeat({
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
    });

    const nextState = mergeState(state, beat, undefined, "open");
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

    return {
      needsMaterialSelection: false as const,
      session: toPublic(
        { ...row, beatIndex: 1, state: nextState },
        voice.speechLocale,
        voice.accent
      ),
      beat,
    };
  }

  static async nextBeat(input: { userId: string; sessionId: string }) {
    const row = await this.requireLiveSession(input.userId, input.sessionId);
    const state = row.state as unknown as ClassroomSessionState;
    const curriculumOutline = asStringArray(row.curriculumOutline);
    const memory = await StudentMemoryService.getOrCreate(input.userId);
    const memoryBlurb = StudentMemoryService.toPromptBlurb(memory);

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
    });

    const nextState = mergeState(state, beat, undefined, "next");
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

    const materialsKey = StudentMemoryService.materialsKey(row.documentIds);
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

    return {
      session: toPublic(
        {
          ...row,
          beatIndex,
          state: nextState,
          status: ended ? "ENDED" : "LIVE",
        },
        voice.speechLocale,
        voice.accent
      ),
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
  }) {
    const silence = Boolean(input.noAnswer);
    const transcript =
      sanitizeClassroomPlainText(input.transcript || "", 280) ||
      (input.transcript || "").trim();
    if (!silence && !transcript) throw new Error("Empty transcript");

    const row = await this.requireLiveSession(input.userId, input.sessionId);
    const state = {
      ...emptyClassroomState(""),
      ...(row.state as unknown as ClassroomSessionState),
    };
    if (typeof input.signals?.confusion === "number" && input.signals.confusion > 0.55) {
      state.understanding = Math.max(0.15, state.understanding - 0.12);
      state.emotionalState = "patient";
    }
    if (typeof input.signals?.frustration === "number" && input.signals.frustration > 0.55) {
      state.emotionalState = "patient";
      state.learningSpeed = "slow";
    }
    if (typeof input.signals?.confidence === "number" && input.signals.confidence > 0.65) {
      state.confidence = clamp01(input.signals.confidence);
      state.emotionalState = "energetic";
    }

    const curriculumOutline = asStringArray(row.curriculumOutline);
    const memory = await StudentMemoryService.getOrCreate(input.userId);
    const memoryBlurb = StudentMemoryService.toPromptBlurb(memory);

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
    });

    const nextState = mergeState(
      state,
      beat,
      silence ? undefined : transcript,
      silence ? "silence" : "react"
    );
    if (silence) {
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

    if (!silence && transcript) {
      void StudentMemoryService.recordQuestion(input.userId, transcript);
    }

    const materialsKey = StudentMemoryService.materialsKey(row.documentIds);
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

    return {
      session: toPublic(
        { ...row, beatIndex, state: nextState, status: "LIVE" },
        voice.speechLocale,
        voice.accent
      ),
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

    const userContent =
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

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ];

    const fallbackMode =
      input.mode === "silence" ? "react" : input.mode === "react" ? "react" : input.mode === "open" ? "open" : "next";

    try {
      const result = await AiProviderService.chat(
        "TEACHING_ASSISTANT",
        messages,
        input.userId,
        {
          temperature: input.mode === "react" || input.mode === "silence" ? 0.35 : 0.45,
          // Beats are always a couple of short sentences + a few board
          // actions — capping output keeps every provider's generation time
          // short instead of letting it use a large admin-configured budget.
          maxTokensExact: input.mode === "open" ? 700 : 550,
        }
      );
      const parsed =
        parseBeat(result.text) ||
        fallbackBeat(
          input.language,
          fallbackMode,
          input.state.currentLessonName || input.curriculumOutline[0] || null
        );
      return finalizeBeat(parsed, input.state, input.language, input.mode);
    } catch {
      return finalizeBeat(
        fallbackBeat(
          input.language,
          fallbackMode,
          input.state.currentLessonName || input.curriculumOutline[0] || null
        ),
        input.state,
        input.language,
        input.mode
      );
    }
  }
}
