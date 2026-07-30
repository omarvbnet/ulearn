import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { AiProviderService } from "../ai-provider.service";
import { StudentMemoryService } from "../student-memory.service";
import { resolveTeacherVoice } from "../voice-accent";
import { sanitizeClassroomPlainText } from "../ai-teacher-prompt";
import type { ChatMessage } from "../types";
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
          parameters.text = sanitizeClassroomPlainText(parameters.text, 48);
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

    return {
      speak,
      board: board.slice(0, 5),
      askStudent,
      waitForStudentMs: Math.max(
        0,
        Math.min(5000, Number(o.waitForStudentMs) || (askStudent ? 2500 : 0))
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
      memoryPatch:
        o.memoryPatch && typeof o.memoryPatch === "object"
          ? (o.memoryPatch as Partial<ClassroomSessionState>)
          : undefined,
    };
  } catch {
    return null;
  }
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
            size: 26,
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
          size: 34,
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

function mergeState(
  state: ClassroomSessionState,
  beat: ClassroomBeat,
  studentTranscript?: string
): ClassroomSessionState {
  const next: ClassroomSessionState = { ...state };
  const patch = beat.memoryPatch || {};
  if (patch.currentLessonName) next.currentLessonName = String(patch.currentLessonName);
  if (patch.currentTopic) next.currentTopic = String(patch.currentTopic);
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
  next.lastAskStudent = beat.askStudent || null;
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
    });

    const nextState = mergeState(state, beat);
    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
        beatIndex: 1,
      },
    });

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

    const nextState = mergeState(state, beat);
    const beatIndex = row.beatIndex + 1;
    const ended = Boolean(beat.sessionComplete) || beatIndex > 40;
    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
        beatIndex,
        status: ended ? "ENDED" : "LIVE",
        endedAt: ended ? new Date() : null,
      },
    });

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
    transcript: string;
    signals?: {
      frustration?: number;
      confidence?: number;
      confusion?: number;
    };
  }) {
    const transcript =
      sanitizeClassroomPlainText(input.transcript, 280) || input.transcript.trim();
    if (!transcript) throw new Error("Empty transcript");

    const row = await this.requireLiveSession(input.userId, input.sessionId);
    const state = { ...(row.state as unknown as ClassroomSessionState) };
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
      mode: "react",
      studentTranscript: transcript,
    });

    const nextState = mergeState(state, beat, transcript);
    const beatIndex = row.beatIndex + 1;
    await prisma.aiClassroomSession.update({
      where: { id: row.id },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
        beatIndex,
        status: "LIVE",
      },
    });

    void StudentMemoryService.recordQuestion(input.userId, transcript);

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

    // Write light long-term memory signals
    try {
      const mem = await StudentMemoryService.getOrCreate(input.userId);
      const completed = [...(mem.completedLessons || [])];
      if (state.currentLessonName && !completed.includes(state.currentLessonName)) {
        completed.unshift(state.currentLessonName);
      }
      await prisma.studentAiMemory.update({
        where: { userId: input.userId },
        data: {
          completedLessons: completed.slice(0, 40),
          preferredStyle: state.teachingStyle || mem.preferredStyle,
          learningSpeed: state.learningSpeed || mem.learningSpeed,
        },
      });
    } catch {
      /* ignore memory writeback failures */
    }

    return {
      ok: true,
      summary:
        state.spokenHistory.slice(-3).join(" ") ||
        "Classroom session completed.",
      lessonName: state.currentLessonName,
    };
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
    mode: "open" | "next" | "react";
    studentTranscript?: string;
    question?: string;
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
    });

    const userContent =
      input.mode === "open"
        ? `Open the live classroom. Student request: ${input.question || "Teach my selected material from the first lesson to the last."}`
        : input.mode === "react"
          ? `Student interrupted: ${input.studentTranscript}`
          : "Continue the live classroom with the next natural teaching beat.";

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ];

    try {
      const result = await AiProviderService.chat(
        "TEACHING_ASSISTANT",
        messages,
        input.userId
      );
      return (
        parseBeat(result.text) ||
        fallbackBeat(
          input.language,
          input.mode,
          input.state.currentLessonName || input.curriculumOutline[0] || null
        )
      );
    } catch {
      return fallbackBeat(
        input.language,
        input.mode,
        input.state.currentLessonName || input.curriculumOutline[0] || null
      );
    }
  }
}
