import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { DatabaseProviderService } from "@/services/database-provider.service";
import { z } from "zod";

const schema = z.object({
  providerId: z.string().optional(),
  databaseUrl: z.string().optional(),
  directUrl: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await DatabaseProviderService.testConnection(parsed.data);
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FAILED";
    return error(msg, 400, msg);
  }
}
