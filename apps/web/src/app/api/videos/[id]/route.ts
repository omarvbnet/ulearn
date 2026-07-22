import { error, json, requireAuth } from "@/lib/api";
import { VideoPlaybackService } from "@/services/video-playback.service";

/** Authorized signed MP4 playback URL — streams directly from Cloudflare R2/CDN. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;

  try {
    const playback = await VideoPlaybackService.authorizeAndGetPlayback(
      id,
      auth.session.userId,
      auth.session.role
    );
    return json({ playback });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "PLAYBACK_FAILED";
    if (msg === "NOT_FOUND") return error("Video not found", 404, "NOT_FOUND");
    if (msg === "FORBIDDEN") return error("Access denied", 403, "FORBIDDEN");
    if (msg === "NOT_READY") return error("Video not ready", 425, "NOT_READY");
    return error("Playback unavailable", 500, "PLAYBACK_FAILED");
  }
}
