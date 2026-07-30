import { error, json, requireAuth } from "@/lib/api";
import { ClassroomSessionService } from "@/services/ai/classroom/classroom-session.service";

/** End a live classroom session and write long-term memory. */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!id) return error("Missing session id", 422, "VALIDATION");

  try {
    const result = await ClassroomSessionService.endSession({
      userId: auth.session.userId,
      sessionId: id,
    });
    return json(result);
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Failed to end classroom",
      500,
      "CLASSROOM_END"
    );
  }
}
