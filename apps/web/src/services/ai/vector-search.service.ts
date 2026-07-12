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
  /** Restrict to any of these subjects (certificate areas of interest). */
  subjectIds?: string[];
  /** When true with subjectIds: only those subjects (no null subject fallback). */
  subjectStrict?: boolean;
  courseId?: string | null;
  /** Soft boost only — never exclude mismatched languages. */
  preferLanguage?: string | null;
  /** @deprecated Hard language filter — avoid; use preferLanguage. */
  language?: string | null;
  lesson?: string | null;
  topK?: number;
  minSimilarity?: number;
  /**
   * When true with educationalStageId: only that stage's docs (no other stages).
   * Unscoped (null stage) docs are used only as fallback if stage-specific hits are empty.
   */
  stageStrict?: boolean;
  /** Teacher Professor Studio: only this instructor's documents. */
  instructorId?: string | null;
  /** Restrict retrieval to these KbDocument ids. */
  documentIds?: string[];
};

export class VectorSearchService {
  static async search(
    queryEmbedding: number[],
    filters: SearchFilters = {}
  ): Promise<RetrievedChunk[]> {
    const topK = Math.min(filters.topK ?? 10, 12);
    const minSim = filters.minSimilarity ?? 0.42;
    const stageId = filters.educationalStageId;

    // Stage-strict: try this stage's materials first, then unscoped fallback.
    if (stageId && filters.stageStrict !== false) {
      const stageHits = await this.searchOnce(queryEmbedding, {
        ...filters,
        educationalStageId: stageId,
        _stageMode: "exact",
      }, topK, minSim);
      if (stageHits.length) return stageHits;

      const unscoped = await this.searchOnce(queryEmbedding, {
        ...filters,
        educationalStageId: null,
        _stageMode: "nullOnly",
      }, topK, minSim);
      return unscoped;
    }

    return this.searchOnce(queryEmbedding, { ...filters, _stageMode: "legacy" }, topK, minSim);
  }

  private static async searchOnce(
    queryEmbedding: number[],
    filters: SearchFilters & { _stageMode?: "exact" | "nullOnly" | "legacy" },
    topK: number,
    minSim: number
  ): Promise<RetrievedChunk[]> {
    try {
      const vec = `[${queryEmbedding.join(",")}]`;
      const params: unknown[] = [vec];
      const clauses: string[] = [];

      if (filters._stageMode === "exact" && filters.educationalStageId) {
        params.push(filters.educationalStageId);
        clauses.push(`AND d."educationalStageId" = $${params.length}`);
      } else if (filters._stageMode === "nullOnly") {
        clauses.push(`AND d."educationalStageId" IS NULL`);
      } else if (filters.educationalStageId) {
        params.push(filters.educationalStageId);
        clauses.push(
          `AND (d."educationalStageId" = $${params.length} OR d."educationalStageId" IS NULL)`
        );
      }

      if (filters.subjectIds?.length) {
        params.push(filters.subjectIds);
        if (filters.subjectStrict) {
          clauses.push(`AND d."subjectId" = ANY($${params.length}::text[])`);
        } else {
          clauses.push(
            `AND (d."subjectId" = ANY($${params.length}::text[]) OR d."subjectId" IS NULL)`
          );
        }
      } else if (filters.subjectId) {
        params.push(filters.subjectId);
        clauses.push(`AND (d."subjectId" = $${params.length} OR d."subjectId" IS NULL)`);
      }
      if (filters.courseId) {
        params.push(filters.courseId);
        clauses.push(`AND (d."courseId" = $${params.length} OR d."courseId" IS NULL)`);
      }
      if (filters.instructorId) {
        params.push(filters.instructorId);
        clauses.push(`AND d."instructorId" = $${params.length}`);
      }
      if (filters.documentIds?.length) {
        params.push(filters.documentIds);
        clauses.push(`AND d.id = ANY($${params.length}::text[])`);
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

  private static async fallbackSearch(
    queryEmbedding: number[],
    filters: SearchFilters & { _stageMode?: "exact" | "nullOnly" | "legacy" },
    topK: number,
    minSim: number
  ): Promise<RetrievedChunk[]> {
    const stageWhere =
      filters._stageMode === "exact" && filters.educationalStageId
        ? { educationalStageId: filters.educationalStageId }
        : filters._stageMode === "nullOnly"
          ? { educationalStageId: null }
          : filters.educationalStageId
            ? {
                OR: [
                  { educationalStageId: filters.educationalStageId },
                  { educationalStageId: null },
                ],
              }
            : {};

    const docs = await prisma.kbDocument.findMany({
      where: {
        status: "READY",
        deletedAt: null,
        ...stageWhere,
        ...(filters.subjectIds?.length
          ? filters.subjectStrict
            ? { subjectId: { in: filters.subjectIds } }
            : {
                OR: [
                  { subjectId: { in: filters.subjectIds } },
                  { subjectId: null },
                ],
              }
          : filters.subjectId
            ? { OR: [{ subjectId: filters.subjectId }, { subjectId: null }] }
            : {}),
        ...(filters.courseId
          ? { OR: [{ courseId: filters.courseId }, { courseId: null }] }
          : {}),
        ...(filters.instructorId ? { instructorId: filters.instructorId } : {}),
        ...(filters.documentIds?.length ? { id: { in: filters.documentIds } } : {}),
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
      .filter((c) => c.similarity >= minSim * 0.85);

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
  const preferLang = filters.preferLanguage || filters.language;
  const boosted = rows
    .map((r) => {
      let score = r.similarity;
      const meta = r.metadata;
      if (filters.subjectId && meta.subjectId === filters.subjectId) score += 0.05;
      if (
        filters.subjectIds?.length &&
        typeof meta.subjectId === "string" &&
        filters.subjectIds.includes(meta.subjectId)
      )
        score += 0.05;
      if (
        filters.educationalStageId &&
        meta.educationalStageId === filters.educationalStageId
      )
        score += 0.04;
      if (
        filters.lesson &&
        (meta.lesson === filters.lesson ||
          String(meta.lesson || "").includes(filters.lesson))
      )
        score += 0.06;
      if (
        preferLang &&
        (meta.language === preferLang || r.metadata.language === preferLang)
      )
        score += 0.03;
      return { ...r, similarity: Math.min(score, 1) };
    })
    .filter((r) => r.similarity >= minSim)
    .sort((a, b) => b.similarity - a.similarity);

  return boosted.slice(0, topK);
}
