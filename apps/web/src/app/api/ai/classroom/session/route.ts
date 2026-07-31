import { error, json, requireAuth } from "@/lib/api";
import { ClassroomGateway, classroomEngineSse } from "@/services/classroom-engine";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  question: z.string().max(4000).optional().default(""),
  language: z.string().max(16).optional(),
  conversationId: z.string().optional(),
  documentIds: z.array(z.string().min(1)).max(20).optional(),
  stream: z.boolean().optional().default(false),
});

/** Classroom Engine v3 — start session via AI Gateway. */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { stream, ...data } = parsed.data;

  if (stream) {
    return classroomEngineSse(async (emit) => {
      try {
        await ClassroomGateway.startSession({
          userId: auth.session.userId,
          ...data,
          onEvent: emit,
        });
      } catch (e) {
        const err = e as Error & { code?: string };
        if (err.code === "AI_CREATIVE_ENTITLEMENT") {
          emit({ type: "error", message: err.message || "Upgrade required" });
          return;
        }
        throw e;
      }
    });
  }

  try {
    const result = await ClassroomGateway.startSession({
      userId: auth.session.userId,
      ...data,
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
