import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";

async function teacherProfileId(userId: string) {
  const p = await prisma.teacherProfile.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true },
  });
  return p?.id;
}

/** Teacher: update own course (sends it back to review). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const profileId = await teacherProfileId(auth.session.userId);
  if (!profileId) return error("Teacher profile not found", 404, "NOT_FOUND");

  const { id } = await params;
  const body = await request.json();
  const result = await TeacherCourseService.updateCourse(profileId, id, body);
  if (!result.success) return error(result.error, 400, result.error);

  return json({ course: result.course });
}

/** Teacher: delete own course. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const profileId = await teacherProfileId(auth.session.userId);
  if (!profileId) return error("Teacher profile not found", 404, "NOT_FOUND");

  const { id } = await params;
  const result = await TeacherCourseService.deleteCourse(profileId, id);
  if (!result.success) return error(result.error, 404, result.error);

  return json({ success: true });
}
