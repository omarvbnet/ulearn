import { error, json, requireAuth } from "@/lib/api";
import { AiProviderService } from "@/services/ai";
import { AiProviderType } from "@prisma/client";
import { z } from "zod";

function providerCreateError(e: unknown) {
  const msg = e instanceof Error ? e.message : "Create failed";
  if (/JINA|AiProviderType|enum/i.test(msg)) {
    return error(
      'Database is missing the JINA provider type. Run in SQL: ALTER TYPE "AiProviderType" ADD VALUE IF NOT EXISTS \'JINA\';',
      500,
      "DB_MIGRATION"
    );
  }
  return error(msg, 500, "CREATE_FAILED");
}

export async function GET() {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const [providers, assignments] = await Promise.all([
    AiProviderService.list(),
    AiProviderService.listModuleAssignments(),
  ]);
  return json({ providers, assignments });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.nativeEnum(AiProviderType),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional().or(z.literal("")),
  model: z.string().min(1),
  apiVersion: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  streaming: z.boolean().optional(),
  retryCount: z.number().int().min(0).max(5).optional(),
  isDefault: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  try {
    const provider = await AiProviderService.create({
      ...parsed.data,
      baseUrl: parsed.data.baseUrl || undefined,
    });
    return json(
      {
        provider: {
          ...provider,
          apiKeyEncrypted: undefined,
          hasApiKey: Boolean(provider.apiKeyEncrypted),
        },
      },
      201
    );
  } catch (e) {
    return providerCreateError(e);
  }
}
