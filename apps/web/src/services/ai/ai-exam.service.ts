import { prisma } from "@/lib/prisma";
import { AiProviderService } from "./ai-provider.service";
import { StudentMemoryService } from "./student-memory.service";
import { languageInstruction } from "./types";
import { SubjectAssessmentService } from "@/services/assessment/subject-assessment.service";
import type { Prisma } from "@prisma/client";

export type AiExamQuestion = {
  text: string;
  options: Record<string, string>;
  correctKey: string;
  /** Optional FLUX diagram for shape-based questions. */
  imageBase64?: string;
};

const PASS_PERCENTAGE = 60;

export function timeLimitForQuestionCount(count: number): number {
  return Math.max(90, count * 45);
}

export function stripCorrectKeys(questions: AiExamQuestion[]) {
  return questions.map((q) => ({
    text: q.text,
    options: q.options,
    ...(q.imageBase64 ? { imageBase64: q.imageBase64 } : {}),
  }));
}

/** Pull a short subject title from chunk text — never "Pages 1–3". */
export function topicTitleFromChunkText(
  texts: string[],
  fallbackIndex = 1
): string {
  for (const raw of texts) {
    const lines = String(raw || "")
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines.slice(0, 6)) {
      const cleaned = line
        .replace(/^#+\s*/, "")
        .replace(/^\d+(\.\d+)*[.)]?\s+/, "")
        .replace(/^pages?\s+\d+.*/i, "")
        .replace(/\bpage\s*\d+\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length < 6 || cleaned.length > 72) continue;
      if (/^https?:/i.test(cleaned) || /^\d+$/.test(cleaned)) continue;
      if (/^(contents|index|references|bibliography|مقدمة|فهرس)/i.test(cleaned))
        continue;
      const words = cleaned.split(/\s+/);
      if (words.length >= 2 && words.length <= 12) return cleaned.slice(0, 60);
    }
  }
  const blob = texts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\bpage\s*\d+\b/gi, "")
    .trim();
  const words = blob
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter((w) => w.length > 2)
    .slice(0, 6);
  if (words.length >= 2) return words.join(" ").slice(0, 48);
  return `Lesson ${fallbackIndex}`;
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
      throw new Error("Select at least one material from your stage library");
    }
    const allowed = await this.listKbDocumentsForUser(userId);
    const allowedIds = new Set(allowed.map((d) => d.id));
    const missing = documentIds.filter((id) => !allowedIds.has(id));
    if (missing.length) {
      throw new Error("Some selected documents are not available for your stage or interests");
    }
    return documentIds;
  }

  /**
   * Build a chapter/section outline from chunk headings for one allowed document.
   */
  static async listDocumentChapters(userId: string, documentId: string) {
    await this.assertDocumentsAllowed(userId, [documentId]);
    const doc = await prisma.kbDocument.findFirst({
      where: { id: documentId, deletedAt: null, status: "READY" },
      select: { id: true, fileName: true, chapter: true, pageCount: true },
    });
    if (!doc) {
      return [] as Array<{
        id: string;
        title: string;
        chunkFrom: number;
        chunkTo: number;
        pageStart: number | null;
        pageEnd: number | null;
      }>;
    }

    const chunks = await prisma.kbChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: "asc" },
      select: {
        chunkIndex: true,
        pageNumber: true,
        text: true,
        metadata: true,
      },
    });

    type Outline = {
      id: string;
      title: string;
      chunkFrom: number;
      chunkTo: number;
      pageStart: number | null;
      pageEnd: number | null;
    };

    const headings: Array<{
      title: string;
      chunkIndex: number;
      page: number | null;
    }> = [];
    const seen = new Set<string>();

    for (const c of chunks) {
      const meta = (c.metadata || {}) as Record<string, unknown>;
      let heading =
        typeof meta.heading === "string" ? meta.heading.trim() : "";
      if (!heading) {
        const first = (c.text || "").split("\n")[0]?.trim() || "";
        if (
          /^#{1,3}\s+\S/.test(first) ||
          /^\d+(\.\d+)*\s+\S.{3,}/.test(first) ||
          /^(الفصل|باب|الوحدة|فصل|بابەت|وانە)\s*/i.test(first)
        ) {
          heading = first.replace(/^#+\s*/, "").slice(0, 120);
        }
      }
      if (!heading || heading.length < 3 || heading.length > 140) continue;
      const key = heading.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      if (/^(introduction|intro|محتويات|contents)$/i.test(heading)) continue;
      seen.add(key);
      headings.push({
        title: heading,
        chunkIndex: c.chunkIndex,
        page: c.pageNumber,
      });
    }

    if (!headings.length && doc.chapter?.trim()) {
      return [
        {
          id: doc.chapter.trim(),
          title: doc.chapter.trim(),
          chunkFrom: 0,
          chunkTo: Math.max(0, chunks.at(-1)?.chunkIndex ?? 0),
          pageStart: chunks[0]?.pageNumber ?? null,
          pageEnd: chunks.at(-1)?.pageNumber ?? null,
        },
      ];
    }

    if (headings.length >= 2) {
      const out: Outline[] = [];
      for (let i = 0; i < headings.length; i++) {
        const h = headings[i]!;
        const next = headings[i + 1];
        const chunkTo = next
          ? next.chunkIndex - 1
          : (chunks.at(-1)?.chunkIndex ?? h.chunkIndex);
        const section = chunks.filter(
          (c) => c.chunkIndex >= h.chunkIndex && c.chunkIndex <= chunkTo
        );
        const pages = section
          .map((c) => c.pageNumber)
          .filter((p): p is number => typeof p === "number");
        out.push({
          id: h.title,
          title: h.title,
          chunkFrom: h.chunkIndex,
          chunkTo,
          pageStart: h.page ?? pages[0] ?? null,
          pageEnd: pages.at(-1) ?? h.page ?? null,
        });
      }
      return out.slice(0, 40);
    }

    // No clear headings — split the document into lesson windows, but name
    // each window from the SUBJECT TEXT inside it (never "Pages 1–3").
    const pageCount = doc.pageCount || 0;
    const numbered = chunks.filter((c) => c.pageNumber != null);
    if (pageCount >= 4 && numbered.length >= 2) {
      const window = Math.max(3, Math.ceil(pageCount / 6));
      const out: Outline[] = [];
      let lessonNo = 1;
      for (let start = 1; start <= pageCount; start += window) {
        const end = Math.min(pageCount, start + window - 1);
        const inRange = chunks.filter(
          (c) =>
            c.pageNumber != null &&
            c.pageNumber >= start &&
            c.pageNumber <= end
        );
        const pool = inRange.length ? inRange : chunks;
        let title = topicTitleFromChunkText(
          pool.map((c) => c.text || ""),
          lessonNo
        );
        // Keep titles unique across the outline.
        const base = title;
        let n = 2;
        while (out.some((o) => o.title.toLowerCase() === title.toLowerCase())) {
          title = `${base} (${n})`;
          n += 1;
        }
        out.push({
          id: title,
          title,
          chunkFrom: pool[0]?.chunkIndex ?? 0,
          chunkTo: pool.at(-1)?.chunkIndex ?? chunks.at(-1)?.chunkIndex ?? 0,
          pageStart: start,
          pageEnd: end,
        });
        lessonNo += 1;
      }
      return out.slice(0, 12);
    }

    if (chunks.length >= 8) {
      const window = Math.max(4, Math.ceil(chunks.length / 6));
      const out: Outline[] = [];
      let lessonNo = 1;
      for (let i = 0; i < chunks.length; i += window) {
        const slice = chunks.slice(i, i + window);
        let title = topicTitleFromChunkText(
          slice.map((c) => c.text || ""),
          lessonNo
        );
        const base = title;
        let n = 2;
        while (out.some((o) => o.title.toLowerCase() === title.toLowerCase())) {
          title = `${base} (${n})`;
          n += 1;
        }
        const pages = slice
          .map((c) => c.pageNumber)
          .filter((p): p is number => typeof p === "number");
        out.push({
          id: title,
          title,
          chunkFrom: slice[0]!.chunkIndex,
          chunkTo: slice.at(-1)!.chunkIndex,
          pageStart: pages[0] ?? null,
          pageEnd: pages.at(-1) ?? null,
        });
        lessonNo += 1;
      }
      return out.slice(0, 12);
    }

    const topic =
      topicTitleFromChunkText(
        chunks.slice(0, 6).map((c) => c.text || ""),
        1
      ) || doc.fileName.replace(/\.[^.]+$/, "");
    return [
      {
        id: topic,
        title: topic,
        chunkFrom: 0,
        chunkTo: chunks.at(-1)?.chunkIndex ?? 0,
        pageStart: chunks[0]?.pageNumber ?? null,
        pageEnd: chunks.at(-1)?.pageNumber ?? null,
      },
    ];
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

    void SubjectAssessmentService.recomputeFromDocuments(input.userId, attempt.documentIds).catch(
      () => {}
    );

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
      "You are U Learn Teaching Assistant — a warm personal tutor reviewing a practice exam.",
      languageInstruction(input.language),
      `Exam: ${input.title}. Score: ${input.percentage}% (${input.passed ? "passed" : "needs review"}). Pass mark 60%.`,
      "Write a short coaching note (Markdown):",
      "1) Celebrate progress in 1 sentence (use the score honestly).",
      "2) Name 1–2 concrete gaps from missed items (concepts, not blame).",
      "3) Give one everyday analogy or mini worked hint for the hardest missed idea.",
      "4) End with a clear study tip (what to revise next).",
      "Keep it under ~120 words. Encouraging, specific, no invented document names.",
      missed.length
        ? `Missed topics:\n${missed.map((m) => `- ${m.text}`).join("\n")}`
        : "The student answered all questions correctly — congratulate and suggest a slightly harder challenge.",
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
