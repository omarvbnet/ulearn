import { prisma } from "@/lib/prisma";
import { AiProviderService } from "../ai-provider.service";
import { EmbeddingService } from "../embedding.service";
import { VectorSearchService } from "../vector-search.service";
import { ProfessorJobService } from "./job.service";
import { ProfessorExportService } from "./export.service";
import { languageInstruction, type ChatMessage } from "../types";
import { LoggingService } from "@/services/logging.service";
import type { ProfessorGenerationType, Prisma } from "@prisma/client";

function normalizeLang(raw?: string | null): string {
  const v = (raw || "en").toLowerCase();
  if (v.startsWith("ar")) return "ar";
  if (v.startsWith("ku")) return "ku";
  if (v.startsWith("tr")) return "tr";
  return "en";
}

const TYPE_LABELS: Record<string, string> = {
  LECTURE: "lecture notes",
  NOTES: "student notes",
  STUDY_GUIDE: "study guide",
  TEACHING_MANUAL: "teaching manual",
  SYLLABUS: "course syllabus",
  LESSON_PLAN: "lesson plan",
  WEEKLY_PLAN: "weekly plan",
  SEMESTER_PLAN: "semester plan",
  LEARNING_OUTCOMES: "learning outcomes",
  PRESENTATION_OUTLINE: "presentation outline",
  CUSTOM: "educational content",
};

export class ProfessorGenerationService {
  static list(instructorId: string) {
    return prisma.professorGeneration.findMany({
      where: { instructorId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        artifacts: { orderBy: { createdAt: "desc" }, take: 10 },
        versions: { orderBy: { version: "desc" }, take: 10 },
      },
    });
  }

  static async get(instructorId: string, id: string) {
    return prisma.professorGeneration.findFirst({
      where: { id, instructorId },
      include: {
        artifacts: { orderBy: { createdAt: "desc" } },
        versions: { orderBy: { version: "desc" } },
        jobs: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
  }

  static async create(input: {
    instructorId: string;
    type: ProfessorGenerationType;
    title: string;
    language?: string;
    params: {
      subject?: string;
      course?: string;
      department?: string;
      academicLevel?: string;
      chapter?: string;
      topic?: string;
      pages?: number;
      difficulty?: string;
      learningStyle?: string;
      extraPrompt?: string;
      courseId?: string;
      documentIds?: string[];
      exportFormats?: Array<"markdown" | "html" | "pdf" | "docx" | "pptx">;
    };
    parentId?: string;
  }) {
    const language = normalizeLang(input.language);
    let version = 1;
    if (input.parentId) {
      const parent = await prisma.professorGeneration.findFirst({
        where: { id: input.parentId, instructorId: input.instructorId },
      });
      if (!parent) throw new Error("Parent generation not found");
      version = parent.version + 1;
    }

    const generation = await prisma.professorGeneration.create({
      data: {
        instructorId: input.instructorId,
        type: input.type,
        title: input.title,
        language,
        params: input.params as Prisma.InputJsonValue,
        status: "QUEUED",
        version,
        parentId: input.parentId,
        courseId: input.params.courseId,
        documentIds: input.params.documentIds || [],
      },
    });

    const job = await ProfessorJobService.create({
      instructorId: input.instructorId,
      type: "GENERATE_CONTENT",
      generationId: generation.id,
      inputJson: { type: input.type, title: input.title },
    });

    ProfessorJobService.enqueue(job.id, async (report) => {
      await report(10);
      let material = "";
      if (input.params.documentIds?.length) {
        const embed = await EmbeddingService.embedText(
          `${input.params.topic || input.title} ${input.params.chapter || ""}`,
          input.instructorId
        );
        const chunks = await VectorSearchService.search(embed, {
          instructorId: input.instructorId,
          documentIds: input.params.documentIds,
          preferLanguage: language,
          topK: 12,
          minSimilarity: 0.3,
          stageStrict: false,
        });
        material = chunks.map((c) => c.text).join("\n\n").slice(0, 16000);
      }
      await report(30);

      const label = TYPE_LABELS[input.type] || "educational content";
      const pages = input.params.pages || 3;
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You are AI Professor Studio content generator for teachers.",
            `Produce a high-quality ${label} in Markdown.`,
            "Include: title, learning objectives, structured sections with headings, examples, and a short summary.",
            `Target length: about ${pages} page(s). Difficulty: ${input.params.difficulty || "medium"}.`,
            `Learning style hint: ${input.params.learningStyle || "balanced"}.`,
            languageInstruction(language),
            "Do not wrap the entire document in a code fence.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Title: ${input.title}`,
            `Subject: ${input.params.subject || "-"}`,
            `Course: ${input.params.course || "-"}`,
            `Department: ${input.params.department || "-"}`,
            `Academic level: ${input.params.academicLevel || "-"}`,
            `Chapter: ${input.params.chapter || "-"}`,
            `Topic: ${input.params.topic || "-"}`,
            input.params.extraPrompt ? `Extra instructions: ${input.params.extraPrompt}` : "",
            material ? `\nSource material excerpts:\n${material}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ];

      const moduleKey =
        (await AiProviderService.resolveProvider("PROFESSOR_CONTENT")) != null
          ? "PROFESSOR_CONTENT"
          : "TEACHING_ASSISTANT";

      const result = await AiProviderService.chat(moduleKey, messages, input.instructorId);
      const markdown = (result.text || "").trim();
      if (!markdown) throw new Error("Empty generation");

      await report(70);
      await prisma.professorGeneration.update({
        where: { id: generation.id },
        data: { markdown, status: "RUNNING" },
      });

      const formats = input.params.exportFormats?.length
        ? input.params.exportFormats
        : (["markdown", "html", "pdf", "docx"] as const);

      const artifacts = await ProfessorExportService.exportAll({
        instructorId: input.instructorId,
        generationId: generation.id,
        title: input.title,
        markdown,
        formats: [...formats],
        language,
      });

      await report(95);
      await prisma.professorGeneration.update({
        where: { id: generation.id },
        data: { status: "SUCCEEDED" },
      });

      void LoggingService.log({
        actorId: input.instructorId,
        action: "PROFESSOR_GENERATE",
        entityType: "ProfessorGeneration",
        entityId: generation.id,
        newValue: { type: input.type, artifacts: artifacts.length },
      });

      return { generationId: generation.id, artifactIds: artifacts.map((a) => a.id) };
    });

    return { generation, jobId: job.id };
  }
}
