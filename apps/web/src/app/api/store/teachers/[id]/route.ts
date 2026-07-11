import { error, json, optionalAuth } from "@/lib/api";
import { TeacherCourseService } from "@/services/teacher-course.service";

/** Public teacher profile with live courses (browse without login). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await optionalAuth();

  const { id } = await params;
  const result = await TeacherCourseService.getTeacherStoreProfile(
    id,
    session?.userId
  );
  if (!result.success) return error("Teacher not found", 404, "NOT_FOUND");

  return json({ teacher: result.teacher, courses: result.courses, shortVideos: result.shortVideos });
}
