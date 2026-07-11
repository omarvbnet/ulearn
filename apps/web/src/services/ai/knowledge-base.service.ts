import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { r2Client, R2_BUCKET } from "@/lib/r2-client";
import { isR2Configured } from "@/lib/r2";
import type { KbSourceType, Prisma } from "@prisma/client";
import { ChunkingService } from "./chunking.service";
import { EmbeddingService } from "./embedding.service";
import { extractTextFromBuffer } from "./text-extract";
import { VectorSearchService } from "./vector-search.service";

export type KbMeta = {
  language?: string | null;
  educationalStageId?: string | null;
  grade?: string | null;
  subjectId?: string | null;
  semester?: string | null;
  chapter?: string | null;
  lesson?: string | null;
  topic?: string | null;
  courseId?: string | null;
  instructorId?: string | null;
};

export class KnowledgeBaseService {
  static async list(params?: { status?: string; q?: string; take?: number }) {
    return prisma.kbDocument.findMany({
      where: {
        deletedAt: null,
        ...(params?.status ? { status: params.status as never } : {}),
        ...(params?.q
          ? { fileName: { contains: params.q, mode: "insensitive" } }
          : {}),
      },
      orderBy: { uploadedAt: "desc" },
      take: params?.take ?? 100,
      include: {
        versions: { orderBy: { version: "desc" }, take: 5 },
        _count: { select: { chunks: true } },
      },
    });
  }

  static async get(id: string) {
    return prisma.kbDocument.findFirst({
      where: { id, deletedAt: null },
      include: {
        versions: { orderBy: { version: "desc" } },
        chunks: { orderBy: { chunkIndex: "asc" }, take: 50, select: {
          id: true, chunkIndex: true, pageNumber: true, text: true, language: true,
        }},
      },
    });
  }

  static async createUpload(input: {
    fileName: string;
    fileKey?: string;
    fileUrl?: string;
    mimeType?: string;
    meta?: KbMeta;
  }) {
    const doc = await prisma.kbDocument.create({
      data: {
        sourceType: "KB_UPLOAD",
        fileName: input.fileName,
        fileKey: input.fileKey,
        fileUrl: input.fileUrl,
        mimeType: input.mimeType,
        language: input.meta?.language,
        educationalStageId: input.meta?.educationalStageId,
        grade: input.meta?.grade,
        subjectId: input.meta?.subjectId,
        semester: input.meta?.semester,
        chapter: input.meta?.chapter,
        lesson: input.meta?.lesson,
        topic: input.meta?.topic,
        courseId: input.meta?.courseId,
        instructorId: input.meta?.instructorId,
        status: "PENDING",
      },
    });
    void this.processDocument(doc.id);
    return doc;
  }

  static async softDelete(id: string) {
    await prisma.kbDocument.update({
      where: { id },
      data: { deletedAt: new Date(), status: "ARCHIVED" },
    });
  }

  static async reprocess(id: string) {
    const doc = await prisma.kbDocument.findUnique({ where: { id } });
    if (!doc) throw new Error("Document not found");

    await prisma.kbDocumentVersion.create({
      data: {
        documentId: id,
        version: doc.version,
        snapshot: {
          fileName: doc.fileName,
          chunkCount: doc.chunkCount,
          status: doc.status,
          processedAt: doc.processedAt,
        },
      },
    });

    await prisma.kbDocument.update({
      where: { id },
      data: {
        version: { increment: 1 },
        status: "PENDING",
        errorMessage: null,
      },
    });

    void this.processDocument(id);
    return { ok: true };
  }

  /** Fire-and-forget ingest from CourseMaterial or LessonContent. */
  static async ingestFromSource(
    sourceType: Extract<KbSourceType, "COURSE_MATERIAL" | "LESSON_CONTENT">,
    sourceId: string,
    payload: {
      fileName: string;
      fileKey?: string | null;
      fileUrl?: string | null;
      mimeType?: string | null;
      meta?: KbMeta;
    }
  ) {
    const existing = await prisma.kbDocument.findFirst({
      where: { sourceType, sourceId, deletedAt: null },
      orderBy: { uploadedAt: "desc" },
    });

    if (existing) {
      await prisma.kbDocumentVersion.create({
        data: {
          documentId: existing.id,
          version: existing.version,
          snapshot: { fileName: existing.fileName, chunkCount: existing.chunkCount },
        },
      });
      await prisma.kbDocument.update({
        where: { id: existing.id },
        data: {
          fileName: payload.fileName,
          fileKey: payload.fileKey,
          fileUrl: payload.fileUrl,
          mimeType: payload.mimeType,
          language: payload.meta?.language ?? existing.language,
          educationalStageId: payload.meta?.educationalStageId ?? existing.educationalStageId,
          grade: payload.meta?.grade ?? existing.grade,
          subjectId: payload.meta?.subjectId ?? existing.subjectId,
          semester: payload.meta?.semester ?? existing.semester,
          chapter: payload.meta?.chapter ?? existing.chapter,
          lesson: payload.meta?.lesson ?? existing.lesson,
          topic: payload.meta?.topic ?? existing.topic,
          courseId: payload.meta?.courseId ?? existing.courseId,
          instructorId: payload.meta?.instructorId ?? existing.instructorId,
          version: { increment: 1 },
          status: "PENDING",
          errorMessage: null,
        },
      });
      void this.processDocument(existing.id);
      return existing.id;
    }

    const doc = await prisma.kbDocument.create({
      data: {
        sourceType,
        sourceId,
        fileName: payload.fileName,
        fileKey: payload.fileKey,
        fileUrl: payload.fileUrl,
        mimeType: payload.mimeType,
        language: payload.meta?.language,
        educationalStageId: payload.meta?.educationalStageId,
        grade: payload.meta?.grade,
        subjectId: payload.meta?.subjectId,
        semester: payload.meta?.semester,
        chapter: payload.meta?.chapter,
        lesson: payload.meta?.lesson,
        topic: payload.meta?.topic,
        courseId: payload.meta?.courseId,
        instructorId: payload.meta?.instructorId,
        status: "PENDING",
      },
    });
    void this.processDocument(doc.id);
    return doc.id;
  }

  static async processDocument(documentId: string) {
    const doc = await prisma.kbDocument.findUnique({ where: { id: documentId } });
    if (!doc || doc.deletedAt) return;

    await prisma.kbDocument.update({
      where: { id: documentId },
      data: { status: "PROCESSING", errorMessage: null },
    });

    try {
      const buffer = await loadFileBuffer(doc.fileKey, doc.fileUrl);
      const { text, pageCount } = await extractTextFromBuffer(buffer, doc.mimeType, doc.fileName);
      const cleaned = cleanText(text);
      if (cleaned.length < 40) {
        throw new Error("No extractable text — scanned OCR is Phase B");
      }

      const pieces = ChunkingService.chunk(cleaned, { language: doc.language || undefined });
      await prisma.kbChunk.deleteMany({ where: { documentId } });

      let index = 0;
      for (const piece of pieces) {
        const embedding = await EmbeddingService.embedText(piece.text);
        const contentHash = createHash("sha256").update(piece.text).digest("hex");
        const metadata: Prisma.InputJsonValue = {
          educationalStageId: doc.educationalStageId,
          subjectId: doc.subjectId,
          courseId: doc.courseId,
          lesson: doc.lesson,
          chapter: doc.chapter,
          topic: doc.topic,
          language: doc.language,
          heading: piece.heading || null,
          sourceType: doc.sourceType,
        };
        const chunk = await prisma.kbChunk.create({
          data: {
            documentId,
            chunkIndex: index++,
            pageNumber: piece.pageNumber ?? null,
            text: piece.text,
            language: doc.language,
            metadata,
            version: doc.version,
            embedding,
            contentHash,
          },
        });
        await VectorSearchService.syncEmbeddingVec(chunk.id, embedding);
      }

      await prisma.kbDocument.update({
        where: { id: documentId },
        data: {
          status: "READY",
          pageCount: pageCount ?? null,
          chunkCount: pieces.length,
          processedAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (e) {
      await prisma.kbDocument.update({
        where: { id: documentId },
        data: {
          status: "FAILED",
          errorMessage: e instanceof Error ? e.message : "Processing failed",
        },
      });
    }
  }
}

function cleanText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function loadFileBuffer(fileKey?: string | null, fileUrl?: string | null): Promise<Buffer> {
  if (fileKey && isR2Configured()) {
    const res = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: fileKey }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error("Empty object from storage");
    return Buffer.from(bytes);
  }

  if (fileKey) {
    const localPath = path.join(process.cwd(), "public", "uploads", fileKey);
    try {
      return await readFile(localPath);
    } catch {
      // fall through to URL
    }
  }

  if (fileUrl) {
    const absolute =
      fileUrl.startsWith("http")
        ? fileUrl
        : `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;
    const res = await fetch(absolute);
    if (!res.ok) throw new Error(`Failed to download file (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  throw new Error("No fileKey or fileUrl to ingest");
}
