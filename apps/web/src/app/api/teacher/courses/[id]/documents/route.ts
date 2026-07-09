import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ContentType } from "@prisma/client";
import { z } from "zod";

async function ownCourse(userId: string, courseId: string) {
  return prisma.course.findFirst({
    where: { id: courseId, deletedAt: null, teacher: { userId, deletedAt: null } },
  });
}

const docSchema = z.object({
  title: z.string().min(1).max(200),
  fileKey: z.string().optional(),
  fileUrl: z.string().url().optional(),
  mimeType: z.string().optional(),
  fileSize: z.number().int().positive().optional(),
  type: z.nativeEnum(ContentType).optional(),
  lessonId: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

/** Teacher: attach a supplementary file (PDF, notes) to a course or lesson. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await ownCourse(auth.session.userId, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const parsed = docSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  if (!parsed.data.fileKey && !parsed.data.fileUrl) {
    return error("fileKey or fileUrl is required", 422, "VALIDATION");
  }

  if (parsed.data.lessonId) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: parsed.data.lessonId, courseId: id },
    });
    if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");
  }

  const document = await prisma.courseMaterial.create({
    data: {
      courseId: id,
      lessonId: parsed.data.lessonId ?? null,
      title: parsed.data.title,
      type: parsed.data.type ?? ContentType.PDF,
      fileKey: parsed.data.fileKey ?? null,
      fileUrl: parsed.data.fileUrl ?? null,
      mimeType: parsed.data.mimeType ?? null,
      fileSize: parsed.data.fileSize ?? null,
      sortOrder: parsed.data.sortOrder ?? 0,
    },
  });

  return json({ document }, 201);
}

/** Teacher: list supplementary files for a course. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await ownCourse(auth.session.userId, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const documents = await prisma.courseMaterial.findMany({
    where: { courseId: id, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { lesson: { select: { id: true, title: true } } },
  });

  return json({ documents });
}
