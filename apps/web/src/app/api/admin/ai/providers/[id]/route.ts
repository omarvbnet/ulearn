import { error, json, requireAuth } from "@/lib/api";
import { AiProviderService } from "@/services/ai";
import { z } from "zod";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const { id } = await params;
  const parsed = z
    .object({
      name: z.string().min(1).max(120).optional(),
      apiKey: z.string().min(1).optional(),
      baseUrl: z.string().nullable().optional(),
      model: z.string().min(1).optional(),
      apiVersion: z.string().nullable().optional(),
      timeoutMs: z.number().int().positive().optional(),
      maxTokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().min(0).max(1).nullable().optional(),
      streaming: z.boolean().optional(),
      retryCount: z.number().int().min(0).max(5).optional(),
      status: z.enum(["ENABLED", "DISABLED"]).optional(),
      isDefault: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    })
    .safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  const provider = await AiProviderService.update(id, parsed.data);
  return json({
    provider: {
      ...provider,
      apiKeyEncrypted: undefined,
      hasApiKey: Boolean(provider.apiKeyEncrypted),
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const { id } = await params;
  await AiProviderService.remove(id);
  return json({ success: true });
}
