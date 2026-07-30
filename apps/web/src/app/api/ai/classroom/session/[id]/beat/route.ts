import { error, json, requireAuth } from "@/lib/api";
import { ClassroomSessionService } from "@/services/ai/classroom/classroom-session.service";

/** Generate the next live classroom teaching beat. */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!id) return error("Missing session id", 422, "VALIDATION");

  try {
    const result = await ClassroomSessionService.nextBeat({
      userId: auth.session.userId,
      sessionId: id,
    });
    return json(result);
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Failed to generate beat",
      500,
      "CLASSROOM_BEAT"
    );
  }
}
