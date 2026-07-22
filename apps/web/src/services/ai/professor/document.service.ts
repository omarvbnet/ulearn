import { prisma } from "@/lib/prisma";
import { KnowledgeBaseService } from "../knowledge-base.service";
import { ProfessorJobService } from "./job.service";
import { LoggingService } from "@/services/logging.service";
import type { KbMeta } from "../knowledge-base.service";

export class ProfessorDocumentService {
  static list(instructorId: string, params?: { status?: string; q?: string }) {
    return KnowledgeBaseService.listForInstructor(instructorId, params);
  }

  static async get(instructorId: string, id: string) {
    const doc = await KnowledgeBaseService.get(id);
    if (!doc || doc.instructorId !== instructorId || doc.sourceType !== "TEACHER_UPLOAD") {
      return null;
    }
    return doc;
  }

  static async create(input: {
    instructorId: string;
    fileName: string;
    fileKey?: string;
    fileUrl?: string;
    mimeType?: string;
    meta?: Omit<KbMeta, "instructorId">;
  }) {
    const doc = await KnowledgeBaseService.createUpload({
      fileName: input.fileName,
      fileKey: input.fileKey,
      fileUrl: input.fileUrl,
      mimeType: input.mimeType,
      sourceType: "TEACHER_UPLOAD",
      meta: {
        ...input.meta,
        instructorId: input.instructorId,
      },
    });

    const job = await ProfessorJobService.create({
      instructorId: input.instructorId,
      type: "INGEST",
      documentId: doc.id,
      inputJson: { fileName: input.fileName },
    });

    // Poll document status into job progress (ingest already kicked off by createUpload).
    ProfessorJobService.enqueue(job.id, async (report) => {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const d = await prisma.kbDocument.findUnique({ where: { id: doc.id } });
        if (!d) throw new Error("Document missing");
        if (d.status === "READY") {
          await report(100);
          return { documentId: doc.id, status: "READY", chunkCount: d.chunkCount };
        }
        if (d.status === "FAILED") {
          throw new Error(d.errorMessage || "Ingest failed");
        }
        await report(Math.min(90, 10 + i * 3));
      }
      const d = await prisma.kbDocument.findUnique({ where: { id: doc.id } });
      return { documentId: doc.id, status: d?.status || "PROCESSING" };
    });

    void LoggingService.log({
      actorId: input.instructorId,
      action: "PROFESSOR_DOC_UPLOAD",
      entityType: "KbDocument",
      entityId: doc.id,
      newValue: { fileName: input.fileName },
    });

    return { document: doc, jobId: job.id };
  }

  static async remove(instructorId: string, id: string) {
    const doc = await this.get(instructorId, id);
    if (!doc) throw new Error("Document not found");
    await KnowledgeBaseService.softDelete(id);
    void LoggingService.log({
      actorId: instructorId,
      action: "PROFESSOR_DOC_DELETE",
      entityType: "KbDocument",
      entityId: id,
    });
    return { ok: true };
  }

  static async reprocess(instructorId: string, id: string) {
    const doc = await this.get(instructorId, id);
    if (!doc) throw new Error("Document not found");
    return KnowledgeBaseService.reprocess(id);
  }

  static async health(instructorId: string) {
    const rows = await prisma.kbDocument.groupBy({
      by: ["status"],
      where: {
        instructorId,
        sourceType: "TEACHER_UPLOAD",
        deletedAt: null,
      },
      _count: true,
    });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r._count;
    return { counts, ready: counts.READY || 0 };
  }
}
