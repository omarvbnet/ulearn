import { error, json, requireAuth } from "@/lib/api";
import { ClassroomSessionService } from "@/services/ai/classroom/classroom-session.service";
import { classroomSseResponse } from "@/services/ai/classroom/sse";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  stream: z.boolean().optional().default(false),
});

/** Generate the next live classroom teaching beat. */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!id) return error("Missing session id", 422, "VALIDATION");

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  const stream = parsed.success ? parsed.data.stream : false;

  if (stream) {
    return classroomSseResponse(async (emit) => {
      await ClassroomSessionService.nextBeat({
        userId: auth.session.userId,
        sessionId: id,
        onEvent: emit,
      });
    });
  }

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
