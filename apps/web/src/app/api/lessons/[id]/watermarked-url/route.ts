import { error, json, requireAuth } from "@/lib/api";
import { VideoWatermarkService } from "@/services/video-watermark.service";
import { z } from "zod";

export const maxDuration = 300;

const schema = z.object({
  contentId: z.string().optional(),
});

/** Returns a viewer-watermarked MP4 URL for casting curriculum lessons. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await VideoWatermarkService.getCurriculumLessonWatermarkedUrl(
    auth.session.userId,
    id,
    parsed.data.contentId
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
