import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { TeacherCourseService } from "@/services/teacher-course.service";
import type { TeacherLevel } from "@prisma/client";

const LEVELS: TeacherLevel[] = ["NEEDS_IMPROVEMENT", "GOOD", "EXCELLENT", "MASTER"];

/** Admin: set a teacher's level manually, or return it to automatic. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const { level, auto } = (await request.json()) as {
    level?: TeacherLevel;
    auto?: boolean;
  };

  if (!auto && (!level || !LEVELS.includes(level))) {
    return error("level must be one of " + LEVELS.join(", "), 422, "VALIDATION");
  }

  const result = await TeacherCourseService.setLevel(id, auth.session.userId, {
    level,
    auto,
  });
  if (!result.success) return error(result.error, 400, result.error);

  return json({ level: result.level });
}
