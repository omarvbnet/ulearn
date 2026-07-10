import { error, json, requireAuth } from "@/lib/api";
import {
  DEFAULT_WATERMARK_CONFIG,
  VideoWatermarkConfigService,
  type VideoWatermarkConfig,
} from "@/services/video-watermark-config.service";
import { z } from "zod";

const patchSchema = z.object({
  brandText: z.string().min(1).max(40).optional(),
  opacity: z.number().min(0.1).max(1).optional(),
  fontSize: z.number().int().min(12).max(72).optional(),
  includeCourseName: z.boolean().optional(),
  includeInstructorName: z.boolean().optional(),
  position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]).optional(),
});

/** Watermark settings for client-side burn-in during upload (Flutter / Web). */
export async function GET() {
  const auth = await requireAuth(["TEACHER", "SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const config = await VideoWatermarkConfigService.get();
  return json({ config });
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const current = await VideoWatermarkConfigService.get();
  const next: VideoWatermarkConfig = { ...current, ...parsed.data };
  await VideoWatermarkConfigService.update(next, auth.session.userId);
  return json({ config: next });
}
