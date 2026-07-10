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
    return error("Lesson not found", 404, "NOT_FOUND");
  }

  return json({
    url: result.url,
    watermarkApplied: result.watermarkApplied,
  });
}
