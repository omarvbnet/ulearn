import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseLessonAdminService } from "@/services/course-lesson-admin.service";
import { z } from "zod";

const patchSchema = z.object({
  action: z.enum(["hide", "unhide", "restore"]),
});

/** Admin: hide, unhide, or restore a course lesson video. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  let result;
  if (parsed.data.action === "hide") {
    result = await CourseLessonAdminService.setHidden(id, auth.session.userId, true);
  } else if (parsed.data.action === "unhide") {
    result = await CourseLessonAdminService.setHidden(id, auth.session.userId, false);
  } else {
    result = await CourseLessonAdminService.restore(id, auth.session.userId);
  }

  if (!result.success) return error("Lesson not found", 404, "NOT_FOUND");
  return json({ lesson: result.lesson });
}

/** Admin: soft-delete a course lesson video. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await CourseLessonAdminService.softDelete(id, auth.session.userId);
  if (!result.success) return error("Lesson not found", 404, "NOT_FOUND");
  return json({ lesson: result.lesson });
}
