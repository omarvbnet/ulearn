import { json, requireAuth } from "@/lib/api";
import { ShortVideoService } from "@/services/short-video.service";

/** Saved short videos for the current user. */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const videos = await ShortVideoService.listSaved(auth.session.userId);
  return json({ videos });
}
