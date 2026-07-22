import { error, json, requireAuth } from "@/lib/api";
import { AiExamService } from "@/services/ai";
import { z } from "zod";

const schema = z.object({
  examAttemptId: z.string().min(1),
  answers: z.record(z.string(), z.string()),
  elapsedSec: z.number().int().min(0).optional(),
  expired: z.boolean().optional(),
  language: z.string().max(16).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await AiExamService.submit({
      userId: auth.session.userId,
      ...parsed.data,
    });
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Submit failed";
    const status =
      msg.includes("not found") ? 404 : msg.includes("already") ? 409 : 500;
    return error(msg, status, "AI_EXAM");
  }
}
