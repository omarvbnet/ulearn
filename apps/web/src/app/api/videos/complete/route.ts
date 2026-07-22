import { error, json, requireAuth } from "@/lib/api";
import { VideoAssetService } from "@/services/video-asset.service";
import { z } from "zod";

const bodySchema = z.object({
  videoId: z.string().min(1),
  size: z.number().int().positive().optional(),
  durationSec: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  watermarkApplied: z.boolean().optional(),
  courseLessonId: z.string().optional(),
});

/** Verify R2 upload and save metadata. Processing happens on the client before upload. */
export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER", "SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const asset = await VideoAssetService.completeUpload({
      videoId: parsed.data.videoId,
      userId: auth.session.userId,
      size: parsed.data.size,
      durationSec: parsed.data.durationSec,
      width: parsed.data.width,
      height: parsed.data.height,
      watermarkApplied: parsed.data.watermarkApplied ?? true,
      courseLessonId: parsed.data.courseLessonId,
    });

    return json({
      video: {
        id: asset.id,
        objectKey: asset.objectKey,
        processingStatus: asset.processingStatus,
        watermarkApplied: asset.watermarkApplied,
        durationSec: asset.durationSec,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "COMPLETE_FAILED";
    if (msg === "NOT_FOUND") return error("Video not found", 404, "NOT_FOUND");
    if (msg === "FORBIDDEN") return error("Forbidden", 403, "FORBIDDEN");
    if (msg === "UPLOAD_INCOMPLETE" || msg === "SIZE_MISMATCH") {
      return error(msg, 422, msg);
    }
    return error("Could not complete upload", 500, "COMPLETE_FAILED");
  }
}
