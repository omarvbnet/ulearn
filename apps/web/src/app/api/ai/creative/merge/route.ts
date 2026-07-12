import { error, json, requireAuth } from "@/lib/api";
import { AiCreativeService } from "@/services/ai/creative";
import { z } from "zod";

const CREATIVE_ROLES = ["STUDENT", "CERTIFICATE_USER"] as const;

const fileSchema = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(120),
  dataBase64: z.string().min(1).max(12_000_000),
});

const schema = z.object({
  files: z.array(fileSchema).min(2).max(12),
});

export async function POST(request: Request) {
  const auth = await requireAuth([...CREATIVE_ROLES]);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await AiCreativeService.merge(
      auth.session.userId,
      parsed.data.files
    );
    return json({ result });
  } catch (e) {
    const err = e as Error & { code?: string; status?: unknown };
    if (err.code === "AI_CREATIVE_ENTITLEMENT") {
      return error(err.message, 402, err.code, { status: err.status });
    }
    return error(err.message || "Merge failed", 500, "AI_CREATIVE_MERGE");
  }
}
