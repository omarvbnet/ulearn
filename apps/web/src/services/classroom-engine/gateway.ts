import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { AiExamService } from "@/services/ai/ai-exam.service";
import {
  classroomSpeechLanguage,
  normLang,
  resolveTeacherVoice,
} from "@/services/ai/voice-accent";
import { isWeakLessonTitle } from "@/services/ai/material-topic";
import { TeachingOrchestrator } from "./orchestrator";
import { ClassroomMemoryService } from "./services/student-memory";
import { KnowledgeRetrievalService } from "./services/knowledge-retrieval";
import {
  emptyEngineState,
  type ClassroomLang,
  type Emit,
  type EngineSessionState,
  type LessonPlan,
  type PublicSession,
  type StudentProfileSnapshot,
} from "./types";

/**
 * AI Gateway — never send user requests directly to DeepSeek.
 * Auth context is assumed validated by the route handler.
 */
export class ClassroomGateway {
  static async startSession(input: {
    userId: string;
    question?: string;
    language?: string | null;
    conversationId?: string | null;
    documentIds?: string[];
    onEvent?: Emit;
  }) {
    const emit = input.onEvent;
    emit?.({
      type: "status",
      presence: "thinking",
      message: "Preparing your classroom…",
    });

    let documentIds = (input.documentIds || []).filter(Boolean);
    if (!documentIds.length) {
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

    documentIds = await AiExamService.assertDocumentsAllowed(
      input.userId,
      documentIds
    );

    // Parallel context load — never sequential when independent.
    const [profile, memory] = await Promise.all([
      loadProfile(input.userId, input.language),
      ClassroomMemoryService.load(input.userId, documentIds),
    ]);

    const uiLanguage = profile.preferredLanguage;
    const speechLanguage = classroomSpeechLanguage({
      language: uiLanguage,
      countryCode: profile.countryCode,
      provinceName: profile.provinceName,
    });
    const voice = resolveTeacherVoice({
      language: uiLanguage,
      countryCode: profile.countryCode,
      provinceName: profile.provinceName,
    });

    const { plan, knowledge } = await KnowledgeRetrievalService.buildLessonPlan({
      userId: input.userId,
      documentIds,
      question: input.question,
      speechLanguage,
    });

    // Resume from first uncompleted lesson when possible.
    const nextUncompleted = plan.curriculumOutline.find(
      (l) => !memory.completedLessons.includes(l)
    );
    if (nextUncompleted) {
      plan.lessonName = nextUncompleted;
      plan.objective = nextUncompleted;
    }

    let state = emptyEngineState(
      uiLanguage,
      speechLanguage,
      profile.countryCode,
      profile.provinceName
    );
    state.memory = memory;
    state.lessonPlan = plan;
    state.lessonName = plan.lessonName;
    state.objective = plan.objective;
    state.currentTopic = plan.objective.slice(0, 40);
    // Stash knowledge into spoken-adjacent memory via preference blurb append.
    state.memory = {
      ...memory,
      preferenceBlurb: [
        memory.preferenceBlurb,
        knowledge[0] ? `Focus: ${knowledge[0].text.slice(0, 120)}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    };

    void ClassroomMemoryService.saveLanguage(input.userId, uiLanguage);

    const row = await prisma.aiClassroomSession.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId || null,
        documentIds: plan.documentIds,
        status: "LIVE",
        locale: uiLanguage,
        countryCode: profile.countryCode,
        provinceName: profile.provinceName,
        materialNames: plan.materialNames,
        curriculumOutline: plan.curriculumOutline as unknown as Prisma.InputJsonValue,
        state: state as unknown as Prisma.InputJsonValue,
        beatIndex: 0,
      },
    });

    const toPublic = (s: EngineSessionState, beatIndex: number) =>
      toPublicSession(row.id, s, plan, voice, beatIndex, "LIVE");

    emit?.({ type: "session", session: toPublic(state, 0) });

    const { beat, state: nextState } = await TeachingOrchestrator.runBeat({
      userId: input.userId,
      sessionId: row.id,
      state,
      plan,
      profile,
      mode: "open",
      emit,
      toPublic,
      beatIndex: 1,
    });

    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
        beatIndex: 1,
        materialNames: plan.materialNames,
        curriculumOutline: plan.curriculumOutline as unknown as Prisma.InputJsonValue,
      },
    });

    void ClassroomMemoryService.persistProgress({
      userId: input.userId,
      documentIds: plan.documentIds,
      materialNames: plan.materialNames,
      curriculumOutline: plan.curriculumOutline,
      lessonName: nextState.lessonName,
      understanding: nextState.understanding,
      confidence: nextState.confidence,
      learningSpeed: profile.learningSpeed,
      mistakes: nextState.mistakes,
    });

    return {
      session: toPublic(nextState, 1),
      beat: toClientBeat(beat),
    };
  }

  static async nextBeat(input: {
    userId: string;
    sessionId: string;
    onEvent?: Emit;
  }) {
    return this.continue(input.userId, input.sessionId, "next", undefined, input.onEvent);
  }

  static async studentTurn(input: {
    userId: string;
    sessionId: string;
    transcript?: string;
    noAnswer?: boolean;
    onEvent?: Emit;
  }) {
    return this.continue(
      input.userId,
      input.sessionId,
      input.noAnswer ? "silence" : "react",
      input.transcript,
      input.onEvent
    );
  }

  static async endSession(input: { userId: string; sessionId: string }) {
    const row = await requireSession(input.userId, input.sessionId);
    const state = row.state as unknown as EngineSessionState;
    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: { status: "ENDED", endedAt: new Date() },
    });
    if (state.lessonName) {
      void ClassroomMemoryService.persistProgress({
        userId: input.userId,
        documentIds: row.documentIds,
        materialNames: row.materialNames,
        curriculumOutline: asStringArray(row.curriculumOutline),
        lessonName: state.lessonName,
        understanding: state.understanding,
        confidence: state.confidence,
        learningSpeed: "normal",
        mistakes: state.mistakes,
        completedLesson: state.phase === "complete" ? state.lessonName : null,
      });
    }
    return { ok: true };
  }

  private static async continue(
    userId: string,
    sessionId: string,
    mode: "next" | "react" | "silence",
    transcript: string | undefined,
    emit?: Emit
  ) {
    const row = await requireSession(userId, sessionId);
    const state = ensureV3State(row);
    const plan = state.lessonPlan || {
      lessonName: state.lessonName || "Lesson",
      objective: state.objective || state.currentTopic || "Lesson",
      conceptOutline: [state.currentTopic || "Lesson"],
      curriculumOutline: asStringArray(row.curriculumOutline),
      documentIds: row.documentIds,
      materialNames: row.materialNames,
    };
    const profile = await loadProfile(userId, row.locale);
    const voice = resolveTeacherVoice({
      language: state.uiLanguage,
      countryCode: state.countryCode,
      provinceName: state.provinceName,
    });
    const toPublic = (s: EngineSessionState, beatIndex: number) =>
      toPublicSession(row.id, s, plan, voice, beatIndex, "LIVE");

    emit?.({ type: "session", session: toPublic(state, row.beatIndex) });

    const { beat, state: nextState } = await TeachingOrchestrator.runBeat({
      userId,
      sessionId: row.id,
      state,
      plan,
      profile,
      mode,
      studentTranscript: transcript,
      emit,
      toPublic,
      beatIndex: row.beatIndex + 1,
    });

    const ended = Boolean(beat.sessionComplete) || nextState.phase === "complete";
    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
        beatIndex: row.beatIndex + 1,
        status: ended ? "ENDED" : "LIVE",
        endedAt: ended ? new Date() : null,
        curriculumOutline: plan.curriculumOutline as unknown as Prisma.InputJsonValue,
      },
    });

    void ClassroomMemoryService.persistProgress({
      userId,
      documentIds: plan.documentIds,
      materialNames: plan.materialNames,
      curriculumOutline: plan.curriculumOutline,
      lessonName: nextState.lessonName,
      understanding: nextState.understanding,
      confidence: nextState.confidence,
      learningSpeed: profile.learningSpeed,
      mistakes: nextState.mistakes,
      completedLesson:
        beat.lessonName && state.lessonName && beat.lessonName !== state.lessonName
          ? state.lessonName
          : ended
            ? nextState.lessonName
            : null,
    });

    return {
      session: toPublic(nextState, row.beatIndex + 1),
      beat: toClientBeat(beat),
    };
  }
}

async function loadProfile(
  userId: string,
  languageHint?: string | null
): Promise<StudentProfileSnapshot> {
  const profile = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      locale: true,
      fullLegalName: true,
      country: { select: { code: true } },
      province: { select: { nameEn: true, nameAr: true, nameTr: true } },
      studentProfile: {
        select: {
          grade: true,
          educationalStage: { select: { nameEn: true } },
        },
      },
    },
  });
  const lang = normLang(languageHint || profile?.locale || "en") as ClassroomLang;
  return {
    userId,
    name: profile?.fullLegalName || null,
    age: null,
    grade: profile?.studentProfile?.grade ?? null,
    stageName: profile?.studentProfile?.educationalStage?.nameEn || null,
    countryCode: profile?.country?.code || null,
    provinceName:
      profile?.province?.nameEn ||
      profile?.province?.nameAr ||
      profile?.province?.nameTr ||
      null,
    preferredLanguage: lang,
    preferredAccent: null,
    preferredStyle: null,
    learningSpeed: "normal",
  };
}

async function requireSession(userId: string, sessionId: string) {
  const row = await prisma.aiClassroomSession.findFirst({
    where: { id: sessionId, userId, status: "LIVE" },
  });
  if (!row) throw new Error("Classroom session not found");
  return row;
}

/** Old sessions may have saved a cover-page teacher name as the lesson —
 * swap any weak title for the first real curriculum entry or a neutral label. */
function sanitizeLessonNaming(
  state: EngineSessionState,
  materialNames: string[]
): EngineSessionState {
  const neutral =
    state.speechLanguage === "ar"
      ? "درس اليوم"
      : state.speechLanguage === "tr"
        ? "Bugünün dersi"
        : "Today's lesson";
  const outline = state.lessonPlan?.curriculumOutline || [];
  const firstGood =
    outline.find((l) => !isWeakLessonTitle(l, materialNames)) || null;
  const fix = (v: string | null | undefined): string | null =>
    v && !isWeakLessonTitle(v, materialNames) ? v : firstGood || neutral;

  if (state.lessonName && isWeakLessonTitle(state.lessonName, materialNames)) {
    state.lessonName = fix(state.lessonName);
  }
  if (state.currentTopic && isWeakLessonTitle(state.currentTopic, materialNames)) {
    state.currentTopic = (firstGood || neutral).slice(0, 48);
  }
  if (state.lessonPlan) {
    if (isWeakLessonTitle(state.lessonPlan.lessonName, materialNames)) {
      state.lessonPlan.lessonName = fix(state.lessonPlan.lessonName) || neutral;
    }
    if (isWeakLessonTitle(state.lessonPlan.objective, materialNames)) {
      state.lessonPlan.objective = state.lessonPlan.lessonName;
    }
  }
  if (state.objective && isWeakLessonTitle(state.objective, materialNames)) {
    state.objective = state.lessonPlan?.objective || neutral;
  }
  return state;
}

function ensureV3State(row: {
  state: unknown;
  locale: string;
  countryCode: string | null;
  provinceName: string | null;
  documentIds: string[];
  materialNames: string[];
  curriculumOutline: unknown;
}): EngineSessionState {
  const raw = row.state as Partial<EngineSessionState> | null;
  if (raw && raw.version === 3) {
    return sanitizeLessonNaming(
      {
        ...emptyEngineState(
          (raw.uiLanguage || normLang(row.locale)) as ClassroomLang,
          raw.speechLanguage ||
            classroomSpeechLanguage({
              language: row.locale,
              countryCode: row.countryCode,
              provinceName: row.provinceName,
            }),
          row.countryCode,
          row.provinceName
        ),
        ...raw,
        version: 3,
      },
      row.materialNames
    );
  }
  // Old v1/v2 sessions cannot drive v3 — start a clean teaching state.
  const ui = normLang(row.locale) as ClassroomLang;
  const speech = classroomSpeechLanguage({
    language: ui,
    countryCode: row.countryCode,
    provinceName: row.provinceName,
  });
  const state = emptyEngineState(ui, speech, row.countryCode, row.provinceName);
  const outline = asStringArray(row.curriculumOutline);
  state.lessonPlan = {
    lessonName: outline[0] || "Lesson",
    objective: outline[0] || "Lesson",
    conceptOutline: outline.slice(0, 4),
    curriculumOutline: outline,
    documentIds: row.documentIds,
    materialNames: row.materialNames,
  };
  state.lessonName = outline[0] || null;
  state.phase = "concept_explanation";
  return sanitizeLessonNaming(state, row.materialNames);
}

function toPublicSession(
  id: string,
  state: EngineSessionState,
  plan: LessonPlan,
  voice: ReturnType<typeof resolveTeacherVoice>,
  beatIndex: number,
  status: "LIVE" | "ENDED"
): PublicSession {
  return {
    id,
    status,
    locale: state.uiLanguage,
    countryCode: state.countryCode,
    provinceName: state.provinceName,
    documentIds: plan.documentIds,
    materialNames: plan.materialNames,
    curriculumOutline: plan.curriculumOutline,
    beatIndex,
    speechLocale: voice.speechLocale,
    accent: voice.accent,
    state: {
      currentLessonName: state.lessonName,
      currentTopic: state.currentTopic,
      emotionalState: state.pedagogy?.emotion || "encouraging",
      understanding: state.understanding,
      confidence: state.confidence,
      lastAskStudent: state.pendingQuestion,
      awaitingCorrectAnswer: state.awaitingAnswer,
      pendingQuestion: state.pendingQuestion,
      lessonStage: state.phase,
      currentWhiteboardStep: state.boardSummary.at(-1) || null,
      currentExample: state.currentExample,
      currentPractice: state.hasPracticed ? state.currentTopic : null,
      currentQuiz: state.pendingQuestion,
      currentSummary: state.phase === "summary" ? state.currentTopic : null,
    },
  };
}

function toClientBeat(beat: {
  speak: string[];
  board: unknown[];
  askStudent: string | null;
  waitForStudentMs: number;
  emotion: string;
  pace: string;
  lessonName: string | null;
  homework: string | null;
  sessionComplete: boolean;
  answerCorrect: boolean | null;
  teachingStrategy: string;
  stageComplete: boolean;
}) {
  return {
    speak: beat.speak,
    board: beat.board,
    askStudent: beat.askStudent,
    waitForStudentMs: beat.waitForStudentMs,
    emotion: beat.emotion,
    pace: beat.pace,
    lessonName: beat.lessonName,
    homework: beat.homework,
    sessionComplete: beat.sessionComplete,
    answerCorrect: beat.answerCorrect,
    teachingStrategy: beat.teachingStrategy,
    stageComplete: beat.stageComplete,
  };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}
