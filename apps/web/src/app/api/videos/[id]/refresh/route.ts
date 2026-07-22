import { error, json, requireAuth } from "@/lib/api";
import { VideoPlaybackService } from "@/services/video-playback.service";

/** Refresh short-lived signed playback URL before expiration. */
export async function POST(
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
    const msg = e instanceof Error ? e.message : "REFRESH_FAILED";
    if (msg === "NOT_FOUND") return error("Video not found", 404, "NOT_FOUND");
    if (msg === "FORBIDDEN") return error("Access denied", 403, "FORBIDDEN");
    return error("Could not refresh playback URL", 500, "REFRESH_FAILED");
  }
}
