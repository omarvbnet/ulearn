import { VideoService } from "@/services/video.service";
import { error, json, requireAuth } from "@/lib/api";
import { z } from "zod";

const schema = z.object({
  lessonId: z.string(),
  positionSec: z.number().min(0),
  durationSec: z.number().min(0),
  watchedDeltaSec: z.number().min(0).optional(),
  completed: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return error("Invalid input", 400);

  const result = await VideoService.updateProgress({
    userId: auth.session.userId,
    ...parsed.data,
  });

  if (!result.success) return error(result.error, 403);
  return json(result);
}
