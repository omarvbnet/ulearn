import { error, json, requireAuth } from "@/lib/api";
import { TeacherCourseService } from "@/services/teacher-course.service";

/** Public teacher profile with all live courses available for purchase. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await TeacherCourseService.getTeacherStoreProfile(
    id,
    auth.session.userId
  );
  if (!result.success) return error("Teacher not found", 404, "NOT_FOUND");

  return json({ teacher: result.teacher, courses: result.courses });
}
