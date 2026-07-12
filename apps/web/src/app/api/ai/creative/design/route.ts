import { error, json, requireAuth } from "@/lib/api";
import { AiCreativeService } from "@/services/ai/creative";
import { z } from "zod";

const CREATIVE_ROLES = ["STUDENT", "CERTIFICATE_USER"] as const;

const schema = z.object({
  format: z.enum(["ppt", "pdf"]),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(4000),
  language: z.string().max(16).optional(),
  outline: z.string().max(4000).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth([...CREATIVE_ROLES]);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await AiCreativeService.design(auth.session.userId, parsed.data);
    return json({ result });
  } catch (e) {
    const err = e as Error & { code?: string; status?: unknown };
    if (err.code === "AI_CREATIVE_ENTITLEMENT") {
      return error(err.message, 402, err.code, { status: err.status });
    }
    return error(err.message || "Design failed", 500, "AI_CREATIVE_DESIGN");
  }
}
