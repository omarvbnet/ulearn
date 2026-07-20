import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { DatabaseProviderService } from "@/services/database-provider.service";
import { z } from "zod";

const schema = z.object({
  backup: z.object({
    format: z.string().optional(),
    version: z.number().optional(),
    tables: z.record(z.string(), z.array(z.unknown())),
  }),
  targetProviderId: z.string().optional(),
  wipeTarget: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid backup payload", 422, "VALIDATION");

  try {
    const result = await DatabaseProviderService.importBackup(parsed.data.backup, {
      actorId: auth.session.userId,
      targetProviderId: parsed.data.targetProviderId,
      wipeTarget: parsed.data.wipeTarget,
    });
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FAILED";
    return error(msg, 400, msg);
  }
}
