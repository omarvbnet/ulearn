import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { ShortVideoAdminService } from "@/services/short-video-admin.service";
import { z } from "zod";

const patchSchema = z.object({
  action: z.enum(["hide", "unhide", "restore"]),
});

/** Admin: hide, unhide, or restore a short video. */
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
    result = await ShortVideoAdminService.setHidden(id, auth.session.userId, true);
  } else if (parsed.data.action === "unhide") {
    result = await ShortVideoAdminService.setHidden(id, auth.session.userId, false);
  } else {
    result = await ShortVideoAdminService.restore(id, auth.session.userId);
  }

  if (!result.success) return error("Video not found", 404, "NOT_FOUND");
  return json({ video: result.video });
}

/** Admin: soft-delete a short video. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await ShortVideoAdminService.softDelete(id, auth.session.userId);
  if (!result.success) return error("Video not found", 404, "NOT_FOUND");
  return json({ video: result.video });
}
