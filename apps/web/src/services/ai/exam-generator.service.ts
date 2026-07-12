import { prisma } from "@/lib/prisma";
import { AiProviderService } from "./ai-provider.service";
import { EmbeddingService } from "./embedding.service";
import { VectorSearchService } from "./vector-search.service";
import { QuizService } from "@/services/quiz.service";
import { languageInstruction } from "./types";
import type { Prisma } from "@prisma/client";

export type GeneratedQuestion = {
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE";
  textEn: string;
  textAr: string;
  textKu: string;
  textTr: string;
  options: Record<string, string>;
  correctKey: string;
  points?: number;
};

export type PracticeQuizPayload = {
  title: string;
  questions: Array<{
    text: string;
    options: Record<string, string>;
    correctKey: string;
  }>;
  citations: Array<{ documentName: string; page: number | null }>;
};

function normalizeLang(raw?: string | null): string {
  const v = (raw || "en").toLowerCase();
  if (v.startsWith("ar")) return "ar";
  if (v.startsWith("ku")) return "ku";
  if (v.startsWith("tr")) return "tr";
  return "en";
}

function parseJsonBlock(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] || text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("Model did not return valid quiz JSON");
  }
}

export class ExamGeneratorService {
  /** Ephemeral practice quiz for students / certificate users (not persisted as Quiz). */
  static async generatePractice(input: {
    userId: string;
    question: string;
    language?: string | null;
    educationalStageId?: string | null;
    subjectIds?: string[];
    documentIds?: string[];
    attachmentText?: string;
    count?: number;
    /** When true (student exams), documentIds are required. */
    requireDocuments?: boolean;
  }): Promise<PracticeQuizPayload> {
    const language = normalizeLang(input.language);
    const count = Math.min(Math.max(input.count ?? 5, 3), 10);

    if (input.requireDocuments && !input.documentIds?.length) {
      throw new Error("Select at least one knowledge document before generating an exam");
    }

    const material = await this.loadMaterialText({
      userId: input.userId,
      question: input.question,
      educationalStageId: input.educationalStageId,
      subjectIds: input.subjectIds,
      documentIds: input.documentIds,
      attachmentText: input.attachmentText,
      allowRagFallback: !input.requireDocuments,
    });

    const prompt = [
      "Generate a short practice quiz as JSON only.",
      languageInstruction(language),
      `Create exactly ${count} multiple-choice questions from the material.`,
      'Schema: {"title":"...","questions":[{"text":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctKey":"A"}]}',
      "correctKey must be one of A|B|C|D. Questions must be answerable from the material.",
      `\nMaterial:\n${material.text.slice(0, 12000)}`,
      input.question ? `\nUser focus: ${input.question}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await AiProviderService.chat(
      "EXAM_GENERATOR",
      [
        { role: "system", content: prompt },
        { role: "user", content: "Generate the quiz JSON now." },
      ],
      input.userId
    ).catch(async () =>
      AiProviderService.chat(
        "TEACHING_ASSISTANT",
        [
          { role: "system", content: prompt },
          { role: "user", content: "Generate the quiz JSON now." },
        ],
        input.userId
      )
    );

    const parsed = parseJsonBlock(result.text) as {
      title?: string;
      questions?: Array<{
        text?: string;
        options?: Record<string, string>;
        correctKey?: string;
      }>;
    };

    const questions = (parsed.questions || [])
      .filter((q) => q.text && q.options && q.correctKey)
      .slice(0, count)
      .map((q) => ({
        text: String(q.text),
        options: q.options as Record<string, string>,
        correctKey: String(q.correctKey).toUpperCase(),
      }));

    if (questions.length < 2) {
      throw new Error("Could not generate enough quiz questions from the selected materials");
    }

    return {
      title: parsed.title || "Practice quiz",
      questions,
      citations: material.citations,
    };
  }

  /** Admin/teacher: create a real Quiz from KB documents. */
  static async generateAndPublish(input: {
    actorId: string;
    educationalStageId: string;
    subjectId?: string | null;
    documentIds: string[];
    titleEn?: string;
    count?: number;
    language?: string | null;
    courseId?: string | null;
    lessonId?: string | null;
    publish?: boolean;
  }) {
    if (!input.documentIds.length) {
      throw new Error("Select at least one knowledge document");
    }

    const practice = await this.generatePractice({
      userId: input.actorId,
      question: "Generate an assessment quiz from these materials",
      language: input.language || "en",
      educationalStageId: input.educationalStageId,
      subjectIds: input.subjectId ? [input.subjectId] : undefined,
      documentIds: input.documentIds,
      count: input.count ?? 8,
      requireDocuments: true,
    });

    const questions: GeneratedQuestion[] = practice.questions.map((q) => ({
      type: "MULTIPLE_CHOICE" as const,
      textEn: q.text,
      textAr: q.text,
      textKu: q.text,
      textTr: q.text,
      options: q.options,
      correctKey: q.correctKey,
      points: 1,
    }));

    const title =
      input.titleEn ||
      practice.title ||
      "AI Generated Quiz";

    if (!input.publish) {
      return { preview: { title, questions, citations: practice.citations }, quiz: null, questions };
    }

    const quiz = await QuizService.createQuiz({
      type: input.lessonId ? "LESSON" : input.courseId ? "COURSE" : "SUBJECT_FINAL",
      titleEn: title,
      titleAr: title,
      titleKu: title,
      titleTr: title,
      subject: input.subjectId
        ? { connect: { id: input.subjectId } }
        : undefined,
      course: input.courseId ? { connect: { id: input.courseId } } : undefined,
      lesson: input.lessonId ? { connect: { id: input.lessonId } } : undefined,
      passPercentage: 50,
      maxAttempts: 3,
      randomize: true,
      isActive: true,
      questions: questions.map((q) => ({
        ...q,
        options: q.options as Prisma.InputJsonValue,
      })),
    });

    return { preview: null, quiz, citations: practice.citations, questions };
  }

  private static async loadMaterialText(input: {
    userId: string;
    question: string;
    educationalStageId?: string | null;
    subjectIds?: string[];
    documentIds?: string[];
    attachmentText?: string;
    allowRagFallback?: boolean;
  }) {
    const citations: Array<{ documentName: string; page: number | null }> = [];
    const parts: string[] = [];

    if (input.attachmentText?.trim()) {
      parts.push(input.attachmentText.trim());
      citations.push({ documentName: "attachment", page: null });
    }

    if (input.documentIds?.length) {
      const chunks = await prisma.kbChunk.findMany({
        where: {
          documentId: { in: input.documentIds },
          document: { status: "READY", deletedAt: null },
        },
        take: 80,
        orderBy: { chunkIndex: "asc" },
        include: { document: { select: { fileName: true } } },
      });
      for (const c of chunks) {
        parts.push(`[${c.document.fileName}]\n${c.text}`);
        citations.push({ documentName: c.document.fileName, page: c.pageNumber });
      }
    } else if (input.allowRagFallback !== false) {
      const embed = await EmbeddingService.embedText(
        input.question || "quiz from materials",
        input.userId
      );
      const hits = await VectorSearchService.search(embed, {
        educationalStageId: input.educationalStageId,
        subjectIds: input.subjectIds,
        subjectStrict: Boolean(input.subjectIds?.length),
        stageStrict: true,
        topK: 12,
        minSimilarity: 0.35,
      });
      for (const h of hits) {
        parts.push(`[${h.fileName}]\n${h.text}`);
        citations.push({ documentName: h.fileName, page: h.pageNumber });
      }
    }

    if (!parts.length) {
      throw new Error("No materials available to generate a quiz");
    }

    return { text: parts.join("\n\n---\n\n"), citations };
  }
}
