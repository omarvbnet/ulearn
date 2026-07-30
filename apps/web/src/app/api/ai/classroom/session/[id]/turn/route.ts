import { error, json, requireAuth } from "@/lib/api";
import { ClassroomSessionService } from "@/services/ai/classroom/classroom-session.service";
import { z } from "zod";

const schema = z.object({
  transcript: z.string().max(1000).optional().default(""),
  noAnswer: z.boolean().optional(),
  signals: z
    .object({
      frustration: z.number().min(0).max(1).optional(),
      confidence: z.number().min(0).max(1).optional(),
      confusion: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

/** Student spoke / typed during the live classroom (or timed out silently). */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!id) return error("Missing session id", 422, "VALIDATION");

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await ClassroomSessionService.studentTurn({
      userId: auth.session.userId,
      sessionId: id,
      transcript: parsed.data.transcript,
      noAnswer: parsed.data.noAnswer,
      signals: parsed.data.signals,
    });
    return json(result);
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Failed to handle student turn",
      500,
      "CLASSROOM_TURN"
    );
  }
}
