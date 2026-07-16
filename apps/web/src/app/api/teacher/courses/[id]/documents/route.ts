import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import {
  findEditableCourse,
  isAdminRole,
  TEACHER_COURSE_ROLES,
} from "@/lib/teacher-course-access";
import { ContentType } from "@prisma/client";
import { z } from "zod";

const docSchema = z.object({
  title: z.string().min(1).max(200),
  // Relative `/api/media/...` gateway URLs are valid for our app (not only absolute http URLs).
  fileKey: z.string().min(1).optional(),
  fileUrl: z.string().min(1).optional(),
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
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id);
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

  const { enqueueCourseMaterialIngest } = await import("@/services/ai/ingest-hooks");
  enqueueCourseMaterialIngest(document);

  return json({ document }, 201);
}

/** Teacher: remove a supplementary file. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const { documentId } = (await request.json()) as { documentId?: string };
  if (!documentId) return error("documentId is required", 422, "VALIDATION");

  await prisma.courseMaterial.updateMany({
    where: { id: documentId, courseId: id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  if (course.status === "APPROVED" && !isAdminRole(auth.session.role)) {
    await TeacherCourseService.markCoursePendingReview(id);
  }

  return json({ success: true });
}

/** Teacher: list supplementary files for a course. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const documents = await prisma.courseMaterial.findMany({
    where: { courseId: id, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { lesson: { select: { id: true, title: true } } },
  });

  return json({ documents });
}

/** Teacher: rename a course document. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const body = z
    .object({
      documentId: z.string().min(1),
      title: z.string().min(1).max(200).optional(),
      lessonId: z.string().nullable().optional(),
    })
    .safeParse(await request.json());
  if (!body.success) return error("Invalid input", 422, "VALIDATION");

  if (body.data.title === undefined && body.data.lessonId === undefined) {
    return error("title or lessonId is required", 422, "VALIDATION");
  }

  if (body.data.lessonId) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: body.data.lessonId, courseId: id, deletedAt: null },
    });
    if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");
  }

  const updated = await prisma.courseMaterial.updateMany({
    where: { id: body.data.documentId, courseId: id, deletedAt: null },
    data: {
      ...(body.data.title !== undefined ? { title: body.data.title } : {}),
      ...(body.data.lessonId !== undefined ? { lessonId: body.data.lessonId } : {}),
    },
  });
  if (updated.count === 0) return error("Document not found", 404, "NOT_FOUND");

  return json({ success: true });
}
