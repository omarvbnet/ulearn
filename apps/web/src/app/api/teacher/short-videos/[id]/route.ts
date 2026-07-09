import { error, json, requireAuth } from "@/lib/api";
import { ShortVideoService } from "@/services/short-video.service";

/** Teacher: soft-delete own short video. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await ShortVideoService.deleteForTeacher(id, auth.session.userId);
  if (!result.success) {
    if (result.error === "FORBIDDEN") return error("Forbidden", 403, "FORBIDDEN");
    return error("Video not found", 404, "NOT_FOUND");
  }

  return json({ ok: true });
}
