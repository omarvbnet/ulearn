import { after } from "next/server";
import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { KnowledgeBaseService } from "@/services/ai";
import { z } from "zod";

export async function GET(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(request.url);
  const stageId = searchParams.get("educationalStageId");
  // Recover stuck PENDING/PROCESSING docs for this stage when admin opens KB.
  if (stageId && stageId !== "unscoped") {
    after(() =>
      KnowledgeBaseService.requeueStuckDocuments({
        educationalStageId: stageId,
        olderThanMs: 60_000,
        take: 5,
      })
    );
  }
  const documents = await KnowledgeBaseService.list({
    status: searchParams.get("status") || undefined,
    q: searchParams.get("q") || undefined,
    educationalStageId: stageId === "unscoped" ? null : stageId || undefined,
    stageOnly: stageId !== null && stageId !== "" && stageId !== "unscoped",
  });
  const counts = await KnowledgeBaseService.countsByStage();
  return json({ documents, counts });
}

const createSchema = z.object({
  fileName: z.string().min(1),
  fileKey: z.string().optional(),
  fileUrl: z.string().optional(),
  mimeType: z.string().optional(),
  language: z.string().optional(),
  /** Required — materials are uploaded per educational stage. */
  educationalStageId: z.string().min(1),
  grade: z.string().optional(),
  subjectId: z.string().optional(),
  semester: z.string().optional(),
  chapter: z.string().optional(),
  lesson: z.string().optional(),
  topic: z.string().optional(),
  courseId: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return error(
      "Invalid input — educational stage is required for each material",
      422,
      "VALIDATION"
    );
  }
  if (!parsed.data.fileKey && !parsed.data.fileUrl) {
    return error("fileKey or fileUrl is required", 422, "VALIDATION");
  }

  const stage = await prisma.educationalStage.findUnique({
    where: { id: parsed.data.educationalStageId },
    select: { isCertificateTrack: true },
  });
  if (!stage) {
    return error("Educational stage not found", 422, "VALIDATION");
  }
  if (stage.isCertificateTrack && !parsed.data.subjectId) {
    return error(
      "Area of Interest (subjectId) is required for Professional Certificates materials",
      422,
      "VALIDATION"
    );
  }

  const doc = await KnowledgeBaseService.createUpload({
    fileName: parsed.data.fileName,
    fileKey: parsed.data.fileKey,
    fileUrl: parsed.data.fileUrl,
    mimeType: parsed.data.mimeType,
    meta: {
      language: parsed.data.language,
      educationalStageId: parsed.data.educationalStageId,
      grade: parsed.data.grade,
      subjectId: parsed.data.subjectId,
      semester: parsed.data.semester,
      chapter: parsed.data.chapter,
      lesson: parsed.data.lesson,
      topic: parsed.data.topic,
      courseId: parsed.data.courseId,
    },
  });
  after(() => KnowledgeBaseService.processDocument(doc.id));
  return json({ document: doc }, 201);
}
