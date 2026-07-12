import { prisma } from "@/lib/prisma";
import { AiProviderService } from "./ai-provider.service";
import { StudentMemoryService } from "./student-memory.service";
import { languageInstruction } from "./types";
import type { Prisma } from "@prisma/client";

export type AiExamQuestion = {
  text: string;
  options: Record<string, string>;
  correctKey: string;
};

const PASS_PERCENTAGE = 60;

export function timeLimitForQuestionCount(count: number): number {
  return Math.max(90, count * 45);
}

export function stripCorrectKeys(questions: AiExamQuestion[]) {
  return questions.map((q) => ({
    text: q.text,
    options: q.options,
  }));
}

export class AiExamService {
  static async createAttempt(input: {
    userId: string;
    conversationId?: string | null;
    documentIds: string[];
    title: string;
    questions: AiExamQuestion[];
  }) {
    const timeLimitSec = timeLimitForQuestionCount(input.questions.length);
    return prisma.aiExamAttempt.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId || null,
        documentIds: input.documentIds,
        title: input.title,
        questions: input.questions as unknown as Prisma.InputJsonValue,
        timeLimitSec,
        status: "PENDING",
      },
    });
  }

  static async getStats(userId: string) {
    const attempts = await prisma.aiExamAttempt.findMany({
      where: {
        userId,
        status: { in: ["SUBMITTED", "EXPIRED"] },
        percentage: { not: null },
      },
      select: { percentage: true, passed: true },
    });
    const total = attempts.length;
    const passed = attempts.filter((a) => a.passed).length;
    const failed = total - passed;
    const avgScore =
      total > 0
        ? Math.round(
            (attempts.reduce((s, a) => s + (a.percentage || 0), 0) / total) * 10
          ) / 10
        : 0;
    return { total, passed, failed, avgScore };
  }

  /**
   * READY admin KB docs for learner exams only:
   * - STUDENT → educational stage materials (Basic Knowledge for that stage)
   * - CERTIFICATE_USER → Professional Certificates materials matching their insights
   * Never falls back to other stages, unscoped uploads, or teacher (instructor) docs.
   */
  static async listKbDocumentsForUser(userId: string) {
    const profile = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        studentProfile: { select: { educationalStageId: true } },
        certificateProfile: {
          select: {
            interests: {
              select: {
                subjectId: true,
                subject: { select: { stageId: true } },
              },
            },
          },
        },
      },
    });
    if (!profile) return [];

    const isCert = profile.role === "CERTIFICATE_USER";
    const interestIds =
      profile.certificateProfile?.interests.map((i) => i.subjectId) ?? [];
    const certStageId =
      profile.certificateProfile?.interests.find((i) => i.subject.stageId)?.subject
        .stageId ?? null;
    const stageId = isCert
      ? certStageId
      : profile.studentProfile?.educationalStageId ?? null;

    if (!stageId) return [];
    if (isCert && !interestIds.length) return [];

    // Recover docs stuck mid-processing so exams don't forever show "still processing".
    const { KnowledgeBaseService } = await import("./knowledge-base.service");
    await KnowledgeBaseService.requeueStuckDocuments({
      educationalStageId: stageId,
      subjectIds: isCert ? interestIds : undefined,
      olderThanMs: 60_000,
      take: 3,
    });

    const select = {
      id: true,
      fileName: true,
      subjectId: true,
      educationalStageId: true,
      pageCount: true,
      updatedAt: true,
    } as const;

    return prisma.kbDocument.findMany({
      where: {
        status: "READY",
        deletedAt: null,
        instructorId: null,
        educationalStageId: stageId,
        ...(isCert ? { subjectId: { in: interestIds } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select,
    });
  }

  /** Extra context for empty-state messaging on clients. */
  static async listKbDocumentsMeta(userId: string) {
    const profile = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        studentProfile: { select: { educationalStageId: true } },
        certificateProfile: {
          select: {
            interests: {
              select: {
                subjectId: true,
                subject: { select: { stageId: true } },
              },
            },
          },
        },
      },
    });
    const isCert = profile?.role === "CERTIFICATE_USER";
    const interestIds =
      profile?.certificateProfile?.interests.map((i) => i.subjectId) ?? [];
    const stageId = isCert
      ? profile?.certificateProfile?.interests.find((i) => i.subject.stageId)
          ?.subject.stageId ?? null
      : profile?.studentProfile?.educationalStageId ?? null;

    const stageFilter =
      stageId && (!isCert || interestIds.length)
        ? {
            deletedAt: null as null,
            instructorId: null as null,
            educationalStageId: stageId,
            ...(isCert ? { subjectId: { in: interestIds } } : {}),
          }
        : null;

    const [pendingForStage, readyCount, failedCount] = stageFilter
      ? await Promise.all([
          prisma.kbDocument.count({
            where: {
              ...stageFilter,
              status: { in: ["PENDING", "PROCESSING"] },
            },
          }),
          prisma.kbDocument.count({
            where: { ...stageFilter, status: "READY" },
          }),
          prisma.kbDocument.count({
            where: { ...stageFilter, status: "FAILED" },
          }),
        ])
      : [0, 0, 0];

    let emptyReason:
      | "none"
      | "processing"
      | "failed"
      | "no_stage"
      | "no_insights"
      | null = null;
    if (!stageId) emptyReason = "no_stage";
    else if (isCert && !interestIds.length) emptyReason = "no_insights";
    else if (readyCount === 0 && pendingForStage > 0) emptyReason = "processing";
    else if (readyCount === 0 && failedCount > 0) emptyReason = "failed";
    else if (readyCount === 0) emptyReason = "none";

    return {
      stageId,
      pendingForStage,
      readyCount,
      failedCount,
      emptyReason,
      scope: isCert ? ("insights" as const) : ("stage" as const),
    };
  }

  static async assertDocumentsAllowed(userId: string, documentIds: string[]) {
    if (!documentIds.length) {
      throw new Error("Select at least one knowledge document before generating an exam");
    }
    const allowed = await this.listKbDocumentsForUser(userId);
    const allowedIds = new Set(allowed.map((d) => d.id));
    const missing = documentIds.filter((id) => !allowedIds.has(id));
    if (missing.length) {
      throw new Error("Some selected documents are not available for your stage or interests");
    }
    return documentIds;
  }

  static async submit(input: {
    userId: string;
    examAttemptId: string;
    answers: Record<string, string>;
    elapsedSec?: number;
    expired?: boolean;
    language?: string | null;
  }) {
    const attempt = await prisma.aiExamAttempt.findFirst({
      where: { id: input.examAttemptId, userId: input.userId },
    });
    if (!attempt) throw new Error("Exam attempt not found");
    if (attempt.status !== "PENDING") {
      throw new Error("This exam was already submitted");
    }

    const questions = (Array.isArray(attempt.questions)
      ? attempt.questions
      : []) as AiExamQuestion[];
    const maxScore = questions.length;
    let score = 0;
    const review = questions.map((q, idx) => {
      const key = String(idx);
      const selected = String(input.answers[key] || input.answers[String(idx)] || "")
        .toUpperCase()
        .trim();
      const correct = String(q.correctKey || "").toUpperCase().trim();
      const isCorrect = selected === correct && selected.length > 0;
      if (isCorrect) score += 1;
      return {
        index: idx,
        text: q.text,
        options: q.options,
        selectedKey: selected || null,
        correctKey: correct,
        isCorrect,
      };
    });

    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
    const passed = percentage >= PASS_PERCENTAGE;
    const status = input.expired ? "EXPIRED" : "SUBMITTED";
    const elapsedSec =
      typeof input.elapsedSec === "number"
        ? Math.max(0, Math.min(input.elapsedSec, attempt.timeLimitSec + 120))
        : null;

    const lang = (input.language || "en").toLowerCase().slice(0, 2);
    let analysis = "";
    try {
      analysis = await this.generateAnalysis({
        title: attempt.title,
        language: lang,
        percentage,
        passed,
        review,
        userId: input.userId,
      });
    } catch {
      analysis =
        lang === "ar"
          ? passed
            ? "أداء جيد. راجع الأسئلة الخاطئة لتعزيز نقاط الضعف."
            : "تحتاج مزيداً من المراجعة على المواد المختارة. ركّز على المفاهيم التي أخطأت فيها."
          : passed
            ? "Solid effort. Review the missed questions to strengthen weak spots."
            : "You need more review on the selected materials. Focus on the concepts you missed.";
    }

    const updated = await prisma.aiExamAttempt.update({
      where: { id: attempt.id },
      data: {
        answers: input.answers as Prisma.InputJsonValue,
        score,
        maxScore,
        percentage,
        passed,
        elapsedSec,
        analysis,
        status,
        completedAt: new Date(),
      },
    });

    await StudentMemoryService.recordExamResult(input.userId, {
      title: attempt.title,
      percentage,
      passed,
      documentIds: attempt.documentIds,
      weakQuestionHints: review.filter((r) => !r.isCorrect).map((r) => r.text.slice(0, 80)),
    });

    if (attempt.conversationId) {
      await prisma.aiMessage.create({
        data: {
          conversationId: attempt.conversationId,
          userId: input.userId,
          role: "ASSISTANT",
          content: formatExamResultMessage({
            title: attempt.title,
            percentage,
            passed,
            score,
            maxScore,
            analysis,
            language: lang,
          }),
          citations: {
            examAttemptId: attempt.id,
            percentage,
            passed,
            score,
            maxScore,
            analysis,
            review,
          } as Prisma.InputJsonValue,
        },
      });
      await prisma.aiConversation.update({
        where: { id: attempt.conversationId },
        data: { updatedAt: new Date() },
      });
    }

    return {
      examAttemptId: updated.id,
      title: attempt.title,
      score,
      maxScore,
      percentage,
      passed,
      elapsedSec,
      timeLimitSec: attempt.timeLimitSec,
      analysis,
      review,
      status,
    };
  }

  private static async generateAnalysis(input: {
    userId: string;
    title: string;
    language: string;
    percentage: number;
    passed: boolean;
    review: Array<{ text: string; isCorrect: boolean; selectedKey: string | null; correctKey: string }>;
  }) {
    const missed = input.review.filter((r) => !r.isCorrect).slice(0, 6);
    const prompt = [
      "You are U Learn Teaching Assistant. Analyze this student's practice exam briefly.",
      languageInstruction(input.language),
      `Exam: ${input.title}. Score: ${input.percentage}% (${input.passed ? "passed" : "failed"}). Pass mark 60%.`,
      "Write 3-6 short sentences: strengths, gaps, and what to study next from the materials.",
      "Do not invent document names. Be encouraging and specific.",
      missed.length
        ? `Missed topics:\n${missed.map((m) => `- ${m.text}`).join("\n")}`
        : "The student answered all questions correctly.",
    ].join("\n");

    const result = await AiProviderService.chat(
      "TEACHING_ASSISTANT",
      [
        { role: "system", content: prompt },
        { role: "user", content: "Write the knowledge analysis now." },
      ],
      input.userId
    );
    return result.text.trim();
  }
}

function formatExamResultMessage(input: {
  title: string;
  percentage: number;
  passed: boolean;
  score: number;
  maxScore: number;
  analysis: string;
  language: string;
}) {
  const lang = input.language;
  if (lang === "ar") {
    return [
      `نتيجة امتحان الذكاء الاصطناعي: ${input.title}`,
      `الدرجة: ${input.score}/${input.maxScore} (${input.percentage}%) — ${input.passed ? "ناجح" : "راسب"}`,
      "",
      input.analysis,
    ].join("\n");
  }
  return [
    `AI exam result: ${input.title}`,
    `Score: ${input.score}/${input.maxScore} (${input.percentage}%) — ${input.passed ? "Passed" : "Failed"}`,
    "",
    input.analysis,
  ].join("\n");
}
