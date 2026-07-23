import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { parseAdminVisibility } from "@/lib/video-visibility";
import {
  CourseLessonAdminService,
  type CourseLessonAdminFilters,
} from "@/services/course-lesson-admin.service";
import type { CourseStatus } from "@prisma/client";

const COURSE_STATUSES = new Set<CourseStatus>([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "CLOSED",
]);

/** Admin: list store course lesson videos with smart search. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const courseStatus = searchParams.get("courseStatus");
  if (courseStatus && !COURSE_STATUSES.has(courseStatus as CourseStatus)) {
    return error("Invalid course status", 422, "VALIDATION");
  }
  const filters: CourseLessonAdminFilters = {
    q: searchParams.get("q") ?? undefined,
    visibility: parseAdminVisibility(searchParams.get("visibility")),
    sort: (searchParams.get("sort") as CourseLessonAdminFilters["sort"]) ?? "newest",
    ...(courseStatus ? { courseStatus: courseStatus as CourseStatus } : {}),
  };

  const lessons = await CourseLessonAdminService.list(filters);
  return json({ lessons });
}
