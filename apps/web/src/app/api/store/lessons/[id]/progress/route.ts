import { error, json, requireAuth } from "@/lib/api";
import { MyCoursesService } from "@/services/my-courses.service";
import { z } from "zod";

const schema = z.object({
  positionSec: z.number().min(0),
  durationSec: z.number().min(0),
  completed: z.boolean().optional(),
});

/** Save watch progress for a store-course video. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await MyCoursesService.updateStoreLessonProgress({
    userId: auth.session.userId,
    lessonId: id,
    ...parsed.data,
  });

  if (!result.success) {
    if (result.error === "NO_ACCESS") return error("No access", 403, "NO_ACCESS");
    return error("Lesson not found", 404, "NOT_FOUND");
  }

  return json(result);
}
