import { error, json, requireAuth } from "@/lib/api";
import { TeacherCourseService } from "@/services/teacher-course.service";

/** Students: request to buy a course (admin confirms payment offline). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await TeacherCourseService.requestPurchase(id, auth.session.userId);
  if (!result.success) return error(result.error, 400, result.error);

  return json({ purchase: result.purchase }, 201);
}
