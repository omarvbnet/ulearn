import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { z } from "zod";

const schema = z.object({
  lessonIds: z.array(z.string().min(1)).min(1),
});

/** Teacher: reorder lessons (interview stays first). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const teacher = await prisma.teacherProfile.findFirst({
    where: { userId: auth.session.userId, deletedAt: null },
    select: { id: true },
  });
  if (!teacher) return error("Teacher profile not found", 404, "NOT_FOUND");

  const { id } = await params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await TeacherCourseService.reorderLessons(
    id,
    teacher.id,
    parsed.data.lessonIds
  );

  if (!result.success) {
    if (result.error === "NOT_FOUND") return error("Course not found", 404, "NOT_FOUND");
    return error("Invalid lesson list", 422, "INVALID_LESSONS");
  }

  return json({ lessonIds: result.lessonIds });
}
