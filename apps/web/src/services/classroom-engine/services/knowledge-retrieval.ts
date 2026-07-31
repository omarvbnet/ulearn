import { ExamGeneratorService } from "@/services/ai/exam-generator.service";
import { EmbeddingService } from "@/services/ai/embedding.service";
import { VectorSearchService } from "@/services/ai/vector-search.service";
import { AiExamService } from "@/services/ai/ai-exam.service";
import {
  cleanMaterialExcerpt,
  isWeakLessonTitle,
  topicFromExcerpt,
} from "@/services/ai/material-topic";
import type { KnowledgeChunk, LessonPlan } from "../types";

/**
 * Knowledge Retrieval — Gemini embeddings only for educational search.
 * Scoped to the selected subject documents, never the whole database.
 */
export class KnowledgeRetrievalService {
  static async buildLessonPlan(input: {
    userId: string;
    documentIds: string[];
    question?: string;
    speechLanguage: "ar" | "en" | "tr";
  }): Promise<{ plan: LessonPlan; knowledge: KnowledgeChunk[] }> {
    const { AiExamService: Exam } = await import("@/services/ai/ai-exam.service");
    const docs = await Exam.assertDocumentsAllowed(input.userId, input.documentIds);
    const [docRows, chaptersByDoc] = await Promise.all([
      (await import("@/lib/prisma")).prisma.kbDocument.findMany({
        where: { id: { in: docs }, deletedAt: null },
        select: { id: true, fileName: true },
      }),
      Promise.all(docs.map((id) => AiExamService.listDocumentChapters(input.userId, id))),
    ]);
    const materialNames = docRows.map((d) => d.fileName).filter(Boolean);
    const chapterMeta: Array<{
      title: string;
      chunkFrom: number;
      chunkTo: number;
      pageStart: number | null;
      pageEnd: number | null;
    }> = [];
    const curriculumOutline: string[] = [];
    for (const chapters of chaptersByDoc) {
      for (const c of chapters) {
        if (!c.title || c.title === "__all__") continue;
        if (isWeakLessonTitle(c.title, materialNames)) continue;
        if (!curriculumOutline.includes(c.title)) {
          curriculumOutline.push(c.title);
          chapterMeta.push(c);
        }
      }
    }
    if (!chapterMeta.length) {
      for (const chapters of chaptersByDoc) {
        for (const c of chapters) {
          if (!c.title || c.title === "__all__") continue;
          chapterMeta.push(c);
        }
      }
    }

    const opening = chapterMeta[0] || null;
    const material = await ExamGeneratorService.loadMaterialForDocuments({
      userId: input.userId,
      documentIds: docs,
      chapterHeading:
        opening && !isWeakLessonTitle(opening.title, materialNames)
          ? opening.title
          : null,
      chunkFrom: opening?.chunkFrom ?? null,
      chunkTo: opening?.chunkTo ?? null,
      pageFrom: opening?.pageStart ?? null,
      pageTo: opening?.pageEnd ?? null,
      ordered: true,
      question: input.question || "teach the subject",
    });
    let excerpt = cleanMaterialExcerpt(
      (material?.text || "").slice(0, 9000),
      materialNames
    );
    if (excerpt.length < 120) {
      const full = await ExamGeneratorService.loadMaterialForDocuments({
        userId: input.userId,
        documentIds: docs,
        ordered: true,
        question: "teach the subject",
      });
      excerpt = cleanMaterialExcerpt((full?.text || "").slice(0, 9000), materialNames);
    }

    const unit = (n: number) =>
      input.speechLanguage === "ar"
        ? `الوحدة ${n}`
        : input.speechLanguage === "tr"
          ? `Ünite ${n}`
          : `Unit ${n}`;

    if (!curriculumOutline.length) {
      const title = topicFromExcerpt(excerpt, unit(1), materialNames);
      curriculumOutline.push(
        isWeakLessonTitle(title, materialNames) ? unit(1) : title
      );
    }

    const lessonName = curriculumOutline[0]!;
    const objective = topicFromExcerpt(
      excerpt,
      lessonName,
      materialNames
    );

    // Embedding search scoped to these documents only (subject materials).
    let knowledge: KnowledgeChunk[] = [];
    try {
      const query = [input.question, lessonName, objective].filter(Boolean).join("\n");
      const embed = await EmbeddingService.embedText(query, input.userId);
      const hits = await VectorSearchService.search(embed, {
        documentIds: docs,
        topK: 10,
        minSimilarity: 0.28,
      });
      knowledge = hits.slice(0, 8).map((h) => ({
        text: h.text.slice(0, 900),
        documentName: h.fileName,
        page: h.pageNumber,
        score: h.similarity,
      }));
    } catch {
      /* fall through to excerpt chunks */
    }
    if (!knowledge.length) {
      knowledge = excerpt
        .split(/\n\n---\n\n/)
        .slice(0, 6)
        .map((t) => ({
          text: t.slice(0, 900),
          documentName: materialNames[0] || "material",
          page: null,
        }));
    }

    const concepts = knowledge
      .map((k) => topicFromExcerpt(k.text, "", materialNames))
      .filter((t) => t && !isWeakLessonTitle(t, materialNames))
      .slice(0, 6);

    return {
      plan: {
        lessonName,
        objective: objective || lessonName,
        conceptOutline: concepts.length ? concepts : [lessonName],
        curriculumOutline,
        documentIds: docs,
        materialNames,
      },
      knowledge,
    };
  }

  static async retrieveForTopic(input: {
    userId: string;
    documentIds: string[];
    topic: string;
  }): Promise<KnowledgeChunk[]> {
    try {
      const embed = await EmbeddingService.embedText(input.topic, input.userId);
      const hits = await VectorSearchService.search(embed, {
        documentIds: input.documentIds,
        topK: 8,
        minSimilarity: 0.3,
      });
      return hits.map((h) => ({
        text: h.text.slice(0, 900),
        documentName: h.fileName,
        page: h.pageNumber,
        score: h.similarity,
      }));
    } catch {
      return [];
    }
  }
}
