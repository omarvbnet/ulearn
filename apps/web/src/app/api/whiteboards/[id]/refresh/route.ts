import { error, json, requireAuth } from "@/lib/api";
import { WhiteboardPlaybackService } from "@/services/whiteboard-playback.service";

/** Refresh expired .ubrd package URL. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;

  try {
    const playback = await WhiteboardPlaybackService.authorizeAndGetPlayback(
      id,
      auth.session.userId,
      auth.session.role
    );
    return json({ playback });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "REFRESH_FAILED";
    if (msg === "NOT_FOUND") return error("Whiteboard not found", 404, "NOT_FOUND");
    if (msg === "FORBIDDEN") return error("Access denied", 403, "FORBIDDEN");
    if (msg === "NOT_READY") return error("Whiteboard not ready", 425, "NOT_READY");
    return error("Refresh unavailable", 500, "REFRESH_FAILED");
  }
}
