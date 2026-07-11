import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { EmbeddingService } from "./embedding.service";

export type RetrievedChunk = {
  id: string;
  documentId: string;
  text: string;
  pageNumber: number | null;
  similarity: number;
  fileName: string;
  metadata: Record<string, unknown>;
};

export type SearchFilters = {
  educationalStageId?: string | null;
  subjectId?: string | null;
  courseId?: string | null;
  language?: string | null;
  lesson?: string | null;
  topK?: number;
  minSimilarity?: number;
};

export class VectorSearchService {
  static async search(
    queryEmbedding: number[],
    filters: SearchFilters = {}
  ): Promise<RetrievedChunk[]> {
    const topK = Math.min(filters.topK ?? 10, 12);
    const minSim = filters.minSimilarity ?? 0.55;

    // Prefer pgvector when available; fall back to Prisma float[] cosine.
    try {
      const vec = `[${queryEmbedding.join(",")}]`;
      // Apply soft filters in SQL when present via unsafe params list.
      const params: unknown[] = [vec];
      const clauses: string[] = [];
      if (filters.educationalStageId) {
        params.push(filters.educationalStageId);
        clauses.push(`AND (d."educationalStageId" = $${params.length} OR d."educationalStageId" IS NULL)`);
      }
      if (filters.subjectId) {
        params.push(filters.subjectId);
        clauses.push(`AND (d."subjectId" = $${params.length} OR d."subjectId" IS NULL)`);
      }
      if (filters.courseId) {
        params.push(filters.courseId);
        clauses.push(`AND (d."courseId" = $${params.length} OR d."courseId" IS NULL)`);
      }
      if (filters.language) {
        params.push(filters.language);
        clauses.push(
          `AND (d.language = $${params.length} OR d.language IS NULL OR c.language = $${params.length})`
        );
      }
      params.push(topK * 3);
      const limitIdx = params.length;

      const rows = await prisma.$queryRawUnsafe<
        {
          id: string;
          documentId: string;
          text: string;
          pageNumber: number | null;
          metadata: Prisma.JsonValue;
          fileName: string;
          similarity: number;
        }[]
      >(
        `
        SELECT
          c.id,
          c."documentId",
          c.text,
          c."pageNumber",
          c.metadata,
          d."fileName",
          1 - (c.embedding_vec <=> $1::vector) AS similarity
        FROM "KbChunk" c
        INNER JOIN "KbDocument" d ON d.id = c."documentId"
        WHERE d.status = 'READY'
          AND d."deletedAt" IS NULL
          AND c.embedding_vec IS NOT NULL
          ${clauses.join("\n")}
        ORDER BY c.embedding_vec <=> $1::vector
        LIMIT $${limitIdx}
        `,
        ...params
      );

      return rankAndCut(
        rows.map((r) => ({
          id: r.id,
          documentId: r.documentId,
          text: r.text,
          pageNumber: r.pageNumber,
          similarity: Number(r.similarity),
          fileName: r.fileName,
          metadata: (r.metadata as Record<string, unknown>) || {},
        })),
        filters,
        topK,
        minSim
      );
    } catch {
      return this.fallbackSearch(queryEmbedding, filters, topK, minSim);
    }
  }

  /** Portable cosine search when pgvector column is missing. */
  private static async fallbackSearch(
    queryEmbedding: number[],
    filters: SearchFilters,
    topK: number,
    minSim: number
  ): Promise<RetrievedChunk[]> {
    const docs = await prisma.kbDocument.findMany({
      where: {
        status: "READY",
        deletedAt: null,
        ...(filters.educationalStageId
          ? { OR: [{ educationalStageId: filters.educationalStageId }, { educationalStageId: null }] }
          : {}),
        ...(filters.subjectId
          ? { OR: [{ subjectId: filters.subjectId }, { subjectId: null }] }
          : {}),
        ...(filters.courseId ? { OR: [{ courseId: filters.courseId }, { courseId: null }] } : {}),
      },
      select: { id: true, fileName: true },
      take: 200,
    });
    if (!docs.length) return [];
    const docMap = new Map(docs.map((d) => [d.id, d.fileName]));
    const chunks = await prisma.kbChunk.findMany({
      where: { documentId: { in: docs.map((d) => d.id) } },
      take: 2000,
    });

    const scored = chunks
      .map((c) => ({
        id: c.id,
        documentId: c.documentId,
        text: c.text,
        pageNumber: c.pageNumber,
        similarity: EmbeddingService.cosineSimilarity(queryEmbedding, c.embedding),
        fileName: docMap.get(c.documentId) || "document",
        metadata: (c.metadata as Record<string, unknown>) || {},
      }))
      .filter((c) => c.similarity >= minSim);

    return rankAndCut(scored, filters, topK, minSim);
  }

  static async syncEmbeddingVec(chunkId: string, embedding: number[]) {
    const vec = `[${embedding.join(",")}]`;
    try {
      await prisma.$executeRaw`
        UPDATE "KbChunk"
        SET embedding_vec = ${vec}::vector
        WHERE id = ${chunkId}
      `;
    } catch {
      // pgvector column may not exist yet — Prisma Float[] is enough for fallback.
    }
  }
}

function rankAndCut(
  rows: RetrievedChunk[],
  filters: SearchFilters,
  topK: number,
  minSim: number
): RetrievedChunk[] {
  const boosted = rows
    .map((r) => {
      let score = r.similarity;
      const meta = r.metadata;
      if (filters.subjectId && meta.subjectId === filters.subjectId) score += 0.05;
      if (filters.educationalStageId && meta.educationalStageId === filters.educationalStageId)
        score += 0.04;
      if (filters.lesson && (meta.lesson === filters.lesson || String(meta.lesson || "").includes(filters.lesson)))
        score += 0.06;
      if (filters.language && (meta.language === filters.language || r.metadata.language === filters.language))
        score += 0.02;
      return { ...r, similarity: Math.min(score, 1) };
    })
    .filter((r) => r.similarity >= minSim)
    .sort((a, b) => b.similarity - a.similarity);

  return boosted.slice(0, topK);
}
