import { CourseService } from "@/services/course.service";
import { error, json, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  if (!user?.countryId) return error("Country not set", 400);

  if (user.status === "PENDING") {
    return error("Account pending approval", 403, "PENDING");
  }

  const stageId = new URL(request.url).searchParams.get("stageId") || undefined;
  const subjects = await CourseService.listSubjects(user.countryId, stageId);
  const stages = await CourseService.listStages(user.countryId);

  return json({ stages, subjects });
}
