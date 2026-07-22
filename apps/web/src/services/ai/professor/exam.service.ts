import { prisma } from "@/lib/prisma";
import { ExamGeneratorService } from "../exam-generator.service";
import { AiProviderService } from "../ai-provider.service";
import { EmbeddingService } from "../embedding.service";
import { VectorSearchService } from "../vector-search.service";
import { ProfessorJobService } from "./job.service";
import { languageInstruction, type ChatMessage } from "../types";
import { LoggingService } from "@/services/logging.service";
import type { Prisma } from "@prisma/client";

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
    throw new Error("Model did not return valid JSON");
  }
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class ProfessorExamService {
  static async generateAndPublish(input: {
    instructorId: string;
    documentIds: string[];
    educationalStageId?: string;
    subjectId?: string;
    titleEn?: string;
    count?: number;
    language?: string;
    courseId?: string;
    lessonId?: string;
    publish?: boolean;
    versions?: ("A" | "B" | "C")[];
    questionTypes?: string[];
    saveToBank?: boolean;
  }) {
    const docs = await prisma.kbDocument.findMany({
      where: {
        id: { in: input.documentIds },
        instructorId: input.instructorId,
        deletedAt: null,
        status: "READY",
      },
      select: { id: true, educationalStageId: true },
    });
    if (docs.length !== input.documentIds.length) {
      throw new Error("Some documents are missing, not READY, or not yours");
    }

    // Verify course ownership when publishing
    if (input.courseId) {
      const profile = await prisma.teacherProfile.findFirst({
        where: { userId: input.instructorId, deletedAt: null },
        select: { id: true },
      });
      const course = profile
        ? await prisma.course.findFirst({
            where: { id: input.courseId, teacherId: profile.id, deletedAt: null },
            select: { id: true, stageId: true, subjectId: true },
          })
        : null;
      if (!course) throw new Error("Course not found or not owned by you");
      if (!input.educationalStageId) input.educationalStageId = course.stageId;
      if (!input.subjectId) input.subjectId = course.subjectId;
    }

    const job = await ProfessorJobService.create({
      instructorId: input.instructorId,
      type: "GENERATE_EXAM",
      documentId: input.documentIds[0],
      inputJson: input as unknown as Prisma.InputJsonValue,
    });

    const stageId =
      input.educationalStageId || docs.find((d) => d.educationalStageId)?.educationalStageId;

    ProfessorJobService.enqueue(job.id, async (report) => {
      await report(20);
      if (!stageId) throw new Error("educationalStageId or courseId required");
      const result = await ExamGeneratorService.generateAndPublish({
        actorId: input.instructorId,
        educationalStageId: stageId,
        subjectId: input.subjectId,
        documentIds: input.documentIds,
        titleEn: input.titleEn,
        count: input.count,
        language: input.language,
        courseId: input.courseId,
        lessonId: input.lessonId,
        publish: input.publish !== false && Boolean(input.courseId),
      });
      await report(70);

      const versions = input.versions?.length ? input.versions : ["A"];
      const bankItems: string[] = [];
      const questions = result.questions || [];

      if (input.saveToBank !== false && questions.length) {
        for (const q of questions) {
          const item = await prisma.professorQuestionBankItem.create({
            data: {
              instructorId: input.instructorId,
              questionType: q.type || "MULTIPLE_CHOICE",
              language: normalizeLang(input.language),
              text: q.textEn || q.textAr || "",
              options: q.options as Prisma.InputJsonValue,
              correctKey: q.correctKey,
              marks: q.points ?? 1,
              courseId: input.courseId,
              documentId: input.documentIds[0],
              examVersion: "A",
              difficulty: "medium",
            },
          });
          bankItems.push(item.id);
        }
      }

      const versionPayload: Record<string, unknown> = {};
      if (questions.length && versions.length > 1) {
        for (const v of versions) {
          const seed = v.charCodeAt(0);
          versionPayload[v] = shuffle(questions, seed).map((q, idx) => ({
            ...q,
            order: idx + 1,
            examVersion: v,
          }));
        }
      }

      await report(95);
      void LoggingService.log({
        actorId: input.instructorId,
        action: "PROFESSOR_EXAM_GENERATE",
        entityType: "Quiz",
        entityId: result.quiz?.id,
        newValue: { documentIds: input.documentIds, bankItems: bankItems.length },
      });

      return {
        quiz: result.quiz,
        questionCount: questions.length,
        bankItemIds: bankItems,
        versions: versionPayload,
        preview: result.preview,
        citations: result.citations,
      };
    });

    return { jobId: job.id };
  }

  /** Rich exam generation with multiple question types (Wave 3). */
  static async generateRich(input: {
    instructorId: string;
    documentIds: string[];
    language?: string;
    count?: number;
    questionTypes?: string[];
    difficulty?: string;
    courseId?: string;
  }) {
    const language = normalizeLang(input.language);
    const types =
      input.questionTypes?.length
        ? input.questionTypes
        : ["MULTIPLE_CHOICE", "TRUE_FALSE", "FILL_BLANK", "SHORT_ANSWER", "ESSAY"];

    const embedding = await EmbeddingService.embedText(
      "exam questions key concepts definitions",
      input.instructorId
    );
    const chunks = await VectorSearchService.search(embedding, {
      instructorId: input.instructorId,
      documentIds: input.documentIds,
      preferLanguage: language,
      topK: 12,
      minSimilarity: 0.3,
      stageStrict: false,
    });
    const material = chunks.map((c) => c.text).join("\n\n").slice(0, 14000);

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "You are an expert exam writer for university/school teachers.",
          languageInstruction(language),
          `Generate ${input.count ?? 10} questions as JSON:`,
          `{"questions":[{"type":"MULTIPLE_CHOICE|TRUE_FALSE|FILL_BLANK|MATCHING|SHORT_ANSWER|ESSAY|PRACTICAL|CASE|PROGRAMMING","text":"...","options":{"A":"...","B":"..."}|null,"correctKey":"A"|null,"answerKey":"...","marks":1,"difficulty":"easy|medium|hard","bloom":"remember|understand|apply|analyze|evaluate|create","timeEstimateSec":60}]}`,
          `Use types from: ${types.join(", ")}. Difficulty preference: ${input.difficulty || "mixed"}.`,
          "Base questions strictly on the material.",
        ].join("\n"),
      },
      { role: "user", content: `Material:\n${material || "(no chunks — invent pedagogy-safe placeholders noting missing material)"}` },
    ];

    const moduleKey =
      (await AiProviderService.resolveProvider("PROFESSOR_DOCUMENT")) != null
        ? "PROFESSOR_DOCUMENT"
        : "EXAM_GENERATOR";

    const result = await AiProviderService.chat(moduleKey, messages, input.instructorId);
    const parsed = parseJsonBlock(result.text) as {
      questions?: Array<Record<string, unknown>>;
    };

    const questions = parsed.questions || [];
    const bankIds: string[] = [];
    for (const q of questions) {
      const item = await prisma.professorQuestionBankItem.create({
        data: {
          instructorId: input.instructorId,
          questionType: String(q.type || "SHORT_ANSWER"),
          language,
          text: String(q.text || ""),
          options: (q.options as Prisma.InputJsonValue) ?? undefined,
          correctKey: q.correctKey ? String(q.correctKey) : undefined,
          answerKey: q.answerKey ? String(q.answerKey) : undefined,
          marks: typeof q.marks === "number" ? q.marks : 1,
          difficulty: q.difficulty ? String(q.difficulty) : input.difficulty,
          bloom: q.bloom ? String(q.bloom) : undefined,
          timeEstimateSec:
            typeof q.timeEstimateSec === "number" ? q.timeEstimateSec : undefined,
          courseId: input.courseId,
          documentId: input.documentIds[0],
        },
      });
      bankIds.push(item.id);
    }

    return { questions, bankItemIds: bankIds };
  }

  static async gradeEssay(input: {
    instructorId: string;
    studentAnswer: string;
    rubric?: string;
    questionText: string;
    maxMarks?: number;
    language?: string;
  }) {
    const language = normalizeLang(input.language);
    const job = await ProfessorJobService.create({
      instructorId: input.instructorId,
      type: "GRADE_ASSIST",
      inputJson: {
        questionText: input.questionText,
        maxMarks: input.maxMarks,
      },
    });

    ProfessorJobService.enqueue(job.id, async (report) => {
      await report(30);
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You are a careful teaching assistant helping a teacher grade.",
            "Return JSON: {\"score\":number,\"maxMarks\":number,\"feedback\":\"...\",\"strengths\":[\"...\"],\"weaknesses\":[\"...\"],\"studyPlan\":[\"...\"]}",
            "Be fair, specific, and constructive. Teacher will review before releasing.",
            languageInstruction(language),
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Question: ${input.questionText}`,
            `Max marks: ${input.maxMarks ?? 10}`,
            `Rubric: ${input.rubric || "Clarity, accuracy, completeness, use of concepts."}`,
            `Student answer:\n${input.studentAnswer}`,
          ].join("\n\n"),
        },
      ];
      const moduleKey =
        (await AiProviderService.resolveProvider("PROFESSOR_CONTENT")) != null
          ? "PROFESSOR_CONTENT"
          : "TEACHING_ASSISTANT";
      const result = await AiProviderService.chat(moduleKey, messages, input.instructorId);
      await report(90);
      return parseJsonBlock(result.text) as Prisma.InputJsonValue;
    });

    return { jobId: job.id };
  }
}
