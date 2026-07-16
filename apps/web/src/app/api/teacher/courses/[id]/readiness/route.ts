import { error, json, requireAuth } from "@/lib/api";
import { TeacherCourseService } from "@/services/teacher-course.service";
import {
  findEditableCourse,
  TEACHER_COURSE_ROLES,
} from "@/lib/teacher-course-access";

/** Teacher or admin: readiness checklist for the course wizard. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id, {
    id: true,
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  await TeacherCourseService.ensureInterviewFromFreePreviews(id);
  const readiness = await TeacherCourseService.getCourseReadiness(id);
  return json({ readiness });
}
