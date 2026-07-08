import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(1).optional(),
  fileKey: z.string().optional(),
  fileUrl: z.string().optional(),
  thumbnailKey: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().int().optional(),
});

/** Teacher: update a lesson. Live courses queue media changes for admin review. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id: courseId, lessonId } = await params;
  const teacher = await prisma.teacherProfile.findFirst({
    where: { userId: auth.session.userId, deletedAt: null },
  });
  if (!teacher) return error("Teacher profile not found", 404);

  const lesson = await prisma.courseLesson.findFirst({
    where: { id: lessonId, courseId, course: { teacherId: teacher.id, deletedAt: null } },
    include: { course: { select: { status: true } } },
  });
  if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const data = parsed.data;
  const hasMediaChange = Boolean(data.fileKey || data.fileUrl || data.thumbnailUrl);

  if (lesson.course.status === "APPROVED" && hasMediaChange) {
    const pending = await prisma.courseLessonUpdateRequest.create({
      data: {
        lessonId,
        teacherId: teacher.id,
        ...data,
        status: "PENDING",
      },
    });
    return json({
      pendingReview: true,
      request: pending,
      message: "Update submitted for admin review.",
    });
  }

  const updated = await prisma.courseLesson.update({ where: { id: lessonId }, data });
  return json({ lesson: updated, pendingReview: false });
}
