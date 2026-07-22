import { error, json, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { MyCoursesService } from "@/services/my-courses.service";

/** Completed courses with total watch time and quiz results. */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  if (!user) return error("Unauthorized", 401);

  const data = await MyCoursesService.listCompleted(user.id, user.role);
  return json(data);
}
