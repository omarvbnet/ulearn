import { error, json, requireAuth } from "@/lib/api";
import { ClassroomGateway, classroomEngineSse } from "@/services/classroom-engine";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  transcript: z.string().max(1000).optional().default(""),
  noAnswer: z.boolean().optional(),
  stream: z.boolean().optional().default(false),
  signals: z
    .object({
      frustration: z.number().min(0).max(1).optional(),
      confidence: z.number().min(0).max(1).optional(),
      confusion: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

/** Classroom Engine v3 — student turn / silence. */
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

  const { stream, ...data } = parsed.data;

  if (stream) {
    return classroomEngineSse(async (emit) => {
      await ClassroomGateway.studentTurn({
        userId: auth.session.userId,
        sessionId: id,
        transcript: data.transcript,
        noAnswer: data.noAnswer,
        onEvent: emit,
      });
    });
  }

  try {
    const result = await ClassroomGateway.studentTurn({
      userId: auth.session.userId,
      sessionId: id,
      transcript: data.transcript,
      noAnswer: data.noAnswer,
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
