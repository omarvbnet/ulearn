import { error, json, requireAuth } from "@/lib/api";
import { VideoWatermarkService } from "@/services/video-watermark.service";

export const maxDuration = 300;

/** Returns a viewer-watermarked MP4 URL for casting to external screens. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await VideoWatermarkService.getStoreLessonWatermarkedUrl(
    auth.session.userId,
    id
  );

  if (!result.ok) {
    if (result.error === "NO_ACCESS") return error("No access", 403, "NO_ACCESS");
    if (result.error === "FFMPEG_UNAVAILABLE" || result.error === "WATERMARK_UNAVAILABLE") {
      return error(
        "Video watermarking requires WATERMARK_SERVICE_URL on Vercel (see apps/watermark-worker)",
        503,
        "WATERMARK_UNAVAILABLE"
      );
    }
    return error("Lesson not found", 404, "NOT_FOUND");
  }

  return json({
    url: result.url,
    cached: result.cached,
    watermark: result.watermark,
  });
}
