import { error, json, requireAuth } from "@/lib/api";
import { ClassroomSessionService } from "@/services/ai/classroom/classroom-session.service";
import { z } from "zod";

const schema = z.object({
  question: z.string().max(4000).optional().default(""),
  language: z.string().max(16).optional(),
  conversationId: z.string().optional(),
  documentIds: z.array(z.string().min(1)).max(20).optional(),
});

/** Start a live AI Teacher classroom session (beat-by-beat). */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await ClassroomSessionService.startSession({
      userId: auth.session.userId,
      ...parsed.data,
    });
    return json(result);
  } catch (e) {
    const err = e as Error & { code?: string; status?: unknown };
    if (err.code === "AI_CREATIVE_ENTITLEMENT") {
      return error(err.message || "Upgrade required", 402, "AI_CREATIVE_ENTITLEMENT", {
        needsUpgrade: true,
        status: err.status,
      });
    }
    return error(
      e instanceof Error ? e.message : "Failed to start classroom",
      500,
      "CLASSROOM_START"
    );
  }
}
