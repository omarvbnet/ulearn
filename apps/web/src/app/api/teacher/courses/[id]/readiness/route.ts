import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";

async function ownTeacherCourse(userId: string, courseId: string) {
  const teacher = await prisma.teacherProfile.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true },
  });
  if (!teacher) return null;
  const course = await prisma.course.findFirst({
    where: { id: courseId, teacherId: teacher.id, deletedAt: null },
  });
  return course ? { course, teacherId: teacher.id } : null;
}

/** Teacher: readiness checklist for the course wizard. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const owned = await ownTeacherCourse(auth.session.userId, id);
  if (!owned) return error("Course not found", 404, "NOT_FOUND");

  const readiness = await TeacherCourseService.getCourseReadiness(id);
  return json({ readiness });
}
