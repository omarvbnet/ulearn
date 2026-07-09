import { error, json, requireAuth } from "@/lib/api";
import { ShortVideoService } from "@/services/short-video.service";

/** Save or unsave a short video. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await ShortVideoService.toggleSave(id, auth.session.userId);
  if (!result.success) return error("Video not found", 404, "NOT_FOUND");

  return json({ savedByMe: result.savedByMe, saves: result.saves });
}
