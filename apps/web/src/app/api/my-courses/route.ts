import { error, json, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { MyCoursesService } from "@/services/my-courses.service";

/** User's subscribed / purchased courses with completion progress. */
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  if (!user) return error("Unauthorized", 401);

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || undefined;
  const sort = (url.searchParams.get("sort") as "recent" | "progress" | "title") || "recent";
  const teacherId = url.searchParams.get("teacherId") || undefined;
  const minProgress = Number(url.searchParams.get("minProgress") || "0");

  const data = await MyCoursesService.list(user.id, user.role, {
    q,
    sort,
    teacherId,
    minProgress: Number.isFinite(minProgress) ? minProgress : 0,
  });

  return json(data);
}
