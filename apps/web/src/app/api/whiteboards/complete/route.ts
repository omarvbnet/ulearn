import { error, json, requireAuth } from "@/lib/api";
import { isWhiteboardLessonsEnabled } from "@/lib/whiteboard-feature";
import { WhiteboardAssetService } from "@/services/whiteboard-asset.service";
import { z } from "zod";
import type { WhiteboardTheme } from "@prisma/client";

const bodySchema = z.object({
  whiteboardId: z.string().min(1),
  size: z.number().int().positive().optional(),
  durationSec: z.number().int().positive().optional(),
  theme: z.enum(["WHITE", "BLACK", "GREEN"]).optional(),
  thumbnailKey: z.string().optional(),
  schemaVersion: z.number().int().positive().optional(),
  courseLessonId: z.string().optional(),
});

/** Verify R2 upload and mark whiteboard package READY. */
export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER", "SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  if (!(await isWhiteboardLessonsEnabled())) {
    return error("Whiteboard lessons are disabled by admin", 403, "FEATURE_DISABLED");
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const asset = await WhiteboardAssetService.completeUpload({
      whiteboardId: parsed.data.whiteboardId,
      userId: auth.session.userId,
      size: parsed.data.size,
      durationSec: parsed.data.durationSec,
      theme: parsed.data.theme as WhiteboardTheme | undefined,
      thumbnailKey: parsed.data.thumbnailKey,
      schemaVersion: parsed.data.schemaVersion,
      courseLessonId: parsed.data.courseLessonId,
    });

    return json({
      whiteboard: {
        id: asset.id,
        objectKey: asset.objectKey,
        processingStatus: asset.processingStatus,
        durationSec: asset.durationSec,
        theme: asset.theme,
        schemaVersion: asset.schemaVersion,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "COMPLETE_FAILED";
    if (msg === "NOT_FOUND") return error("Whiteboard not found", 404, "NOT_FOUND");
    if (msg === "FORBIDDEN") return error("Forbidden", 403, "FORBIDDEN");
    if (msg === "UPLOAD_INCOMPLETE" || msg === "SIZE_MISMATCH" || msg === "INVALID_STATE") {
      return error(msg, 422, msg);
    }
    return error("Could not complete upload", 500, "COMPLETE_FAILED");
  }
}
