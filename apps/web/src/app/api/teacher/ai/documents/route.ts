import { error, json, requireAuth } from "@/lib/api";
import { ProfessorDocumentService } from "@/services/ai/professor";
import { z } from "zod";

export async function GET(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(request.url);
  const [documents, health] = await Promise.all([
    ProfessorDocumentService.list(auth.session.userId, {
      status: searchParams.get("status") || undefined,
      q: searchParams.get("q") || undefined,
    }),
    ProfessorDocumentService.health(auth.session.userId),
  ]);
  return json({ documents, health });
}

const createSchema = z.object({
  fileName: z.string().min(1),
  fileKey: z.string().optional(),
  fileUrl: z.string().optional(),
  mimeType: z.string().optional(),
  language: z.string().optional(),
  educationalStageId: z.string().optional(),
  subjectId: z.string().optional(),
  courseId: z.string().optional(),
  chapter: z.string().optional(),
  lesson: z.string().optional(),
  topic: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  if (!parsed.data.fileKey && !parsed.data.fileUrl) {
    return error("fileKey or fileUrl is required", 422, "VALIDATION");
  }
  const result = await ProfessorDocumentService.create({
    instructorId: auth.session.userId,
    fileName: parsed.data.fileName,
    fileKey: parsed.data.fileKey,
    fileUrl: parsed.data.fileUrl,
    mimeType: parsed.data.mimeType,
    meta: {
      language: parsed.data.language,
      educationalStageId: parsed.data.educationalStageId,
      subjectId: parsed.data.subjectId,
      courseId: parsed.data.courseId,
      chapter: parsed.data.chapter,
      lesson: parsed.data.lesson,
      topic: parsed.data.topic,
    },
  });
  return json(result, 201);
}
