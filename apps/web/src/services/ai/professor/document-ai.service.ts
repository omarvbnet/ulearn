import { prisma } from "@/lib/prisma";
import { AiProviderService } from "../ai-provider.service";
import { EmbeddingService } from "../embedding.service";
import { VectorSearchService } from "../vector-search.service";
import { ProfessorJobService } from "./job.service";
import { languageInstruction, type ChatMessage } from "../types";
import { LoggingService } from "@/services/logging.service";
import type { Prisma } from "@prisma/client";

const ACTIONS = [
  "SUMMARIZE",
  "EXPLAIN",
  "CHAPTER_ANALYSIS",
  "EXTRACT_CONCEPTS",
  "EXTRACT_FORMULAS",
  "EXTRACT_DEFINITIONS",
  "EXTRACT_TABLES",
  "TIMELINE",
  "FLASHCARDS",
  "MIND_MAP",
  "NOTES",
  "PRESENTATION_OUTLINE",
  "QUESTIONS",
  "ASSIGNMENT",
] as const;

export type DocumentAction = (typeof ACTIONS)[number];

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
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("Model did not return valid JSON");
  }
}

const PROMPTS: Record<DocumentAction, string> = {
  SUMMARIZE: "Summarize the material clearly for teachers. Return Markdown.",
  EXPLAIN: "Explain the material as if teaching a class. Return Markdown.",
  CHAPTER_ANALYSIS: "Provide chapter-by-chapter analysis. Return Markdown.",
  EXTRACT_CONCEPTS: 'Extract key concepts as JSON: {"concepts":[{"name":"","definition":""}]}',
  EXTRACT_FORMULAS: 'Extract formulas as JSON: {"formulas":[{"name":"","expression":"","notes":""}]}',
  EXTRACT_DEFINITIONS:
    'Extract definitions as JSON: {"definitions":[{"term":"","definition":""}]}',
  EXTRACT_TABLES: 'Extract tables as JSON: {"tables":[{"title":"","headers":[],"rows":[[]]}]}',
  TIMELINE: 'Build a timeline as JSON: {"events":[{"date":"","event":""}]}',
  FLASHCARDS:
    'Create flashcards as JSON: {"cards":[{"front":"","back":"","tag":""}]} (12-20 cards)',
  MIND_MAP:
    'Create a mind map as JSON: {"root":"","children":[{"label":"","children":[{"label":""}]}]}',
  NOTES: "Produce concise study notes in Markdown.",
  PRESENTATION_OUTLINE: "Produce a slide-by-slide presentation outline in Markdown.",
  QUESTIONS: 'Generate practice questions as JSON: {"questions":[{"type":"","text":"","answer":""}]}',
  ASSIGNMENT: "Create a graded assignment brief in Markdown with rubric.",
};

export class ProfessorDocumentAiService {
  static actions() {
    return ACTIONS;
  }

  static async run(input: {
    instructorId: string;
    documentId: string;
    action: DocumentAction;
    language?: string;
  }) {
    if (!ACTIONS.includes(input.action)) throw new Error("Unknown action");

    const doc = await prisma.kbDocument.findFirst({
      where: {
        id: input.documentId,
        instructorId: input.instructorId,
        sourceType: "TEACHER_UPLOAD",
        deletedAt: null,
      },
    });
    if (!doc) throw new Error("Document not found");
    if (doc.status !== "READY") throw new Error("Document is not READY yet");

    const language = normalizeLang(input.language);
    const job = await ProfessorJobService.create({
      instructorId: input.instructorId,
      type: "DOCUMENT_ACTION",
      documentId: doc.id,
      inputJson: { action: input.action },
    });

    ProfessorJobService.enqueue(job.id, async (report) => {
      await report(15);
      const embed = await EmbeddingService.embedText(
        `${input.action} ${doc.fileName}`,
        input.instructorId
      );
      const chunks = await VectorSearchService.search(embed, {
        instructorId: input.instructorId,
        documentIds: [doc.id],
        preferLanguage: language,
        topK: 14,
        minSimilarity: 0.25,
        stageStrict: false,
      });
      const material = chunks.map((c) => c.text).join("\n\n").slice(0, 16000);
      await report(40);

      const wantsJson = PROMPTS[input.action].includes("JSON");
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You are AI Professor Studio document analyst.",
            PROMPTS[input.action],
            languageInstruction(language),
            wantsJson ? "Return ONLY valid JSON." : "Return clean Markdown.",
          ].join("\n"),
        },
        {
          role: "user",
          content: `Document: ${doc.fileName}\n\nExcerpts:\n${material || "(empty)"}`,
        },
      ];

      const moduleKey =
        (await AiProviderService.resolveProvider("PROFESSOR_DOCUMENT")) != null
          ? "PROFESSOR_DOCUMENT"
          : "TEACHING_ASSISTANT";
      const result = await AiProviderService.chat(moduleKey, messages, input.instructorId);
      await report(80);

      let contentText = (result.text || "").trim();
      let kind: "MARKDOWN" | "JSON" | "FLASHCARDS" | "MIND_MAP" = "MARKDOWN";
      let meta: Prisma.InputJsonValue | undefined;

      if (wantsJson) {
        const parsed = parseJsonBlock(contentText);
        contentText = JSON.stringify(parsed, null, 2);
        if (input.action === "FLASHCARDS") kind = "FLASHCARDS";
        else if (input.action === "MIND_MAP") kind = "MIND_MAP";
        else kind = "JSON";
        meta = { action: input.action, parsed };
      }

      const artifact = await prisma.professorArtifact.create({
        data: {
          instructorId: input.instructorId,
          jobId: job.id,
          documentId: doc.id,
          kind,
          fileName: `${doc.fileName.replace(/\.[^.]+$/, "")}_${input.action.toLowerCase()}.${kind === "MARKDOWN" ? "md" : "json"}`,
          contentText,
          meta,
        },
      });

      // Persist flashcards/questions into bank lightly
      if (input.action === "QUESTIONS" && meta && typeof meta === "object") {
        const qs =
          (meta as { parsed?: { questions?: Array<Record<string, unknown>> } }).parsed
            ?.questions || [];
        for (const q of qs.slice(0, 40)) {
          await prisma.professorQuestionBankItem.create({
            data: {
              instructorId: input.instructorId,
              questionType: String(q.type || "SHORT_ANSWER"),
              language,
              text: String(q.text || ""),
              answerKey: q.answer ? String(q.answer) : undefined,
              documentId: doc.id,
            },
          });
        }
      }

      void LoggingService.log({
        actorId: input.instructorId,
        action: "PROFESSOR_DOC_ACTION",
        entityType: "ProfessorArtifact",
        entityId: artifact.id,
        newValue: { action: input.action, documentId: doc.id },
      });

      return { artifactId: artifact.id, kind, action: input.action };
    });

    return { jobId: job.id };
  }
}
