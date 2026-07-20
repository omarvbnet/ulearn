import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { DatabaseProviderService } from "@/services/database-provider.service";
import { z } from "zod";

const migrateSchema = z.object({
  action: z.literal("migrate"),
  providerId: z.string().min(1),
  wipeTarget: z.boolean().optional(),
});

const confirmSchema = z.object({
  action: z.literal("confirm"),
  providerId: z.string().min(1),
});

const compareSchema = z.object({
  action: z.literal("compare"),
  providerId: z.string().min(1),
});

const probeSchema = z.object({
  action: z.literal("transfer_test"),
  providerId: z.string().min(1),
});

const schema = z.discriminatedUnion("action", [
  migrateSchema,
  confirmSchema,
  compareSchema,
  probeSchema,
]);

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    if (parsed.data.action === "transfer_test") {
      const result = await DatabaseProviderService.runTransferProbe(
        parsed.data.providerId,
        auth.session.userId
      );
      if (!result.ok) {
        return error(result.summary || "TRANSFER_TEST_FAILED", 400, "TRANSFER_TEST_FAILED", {
          probe: result,
        });
      }
      return json({ success: true, probe: result });
    }
    if (parsed.data.action === "migrate") {
      const result = await DatabaseProviderService.migrateToProvider(
        parsed.data.providerId,
        auth.session.userId,
        { wipeTarget: parsed.data.wipeTarget }
      );
      if (!result.success) {
        return error(
          "message" in result && result.message
            ? result.message
            : result.error,
          400,
          result.error,
          {
            test: "test" in result ? result.test : undefined,
            probe: "probe" in result ? result.probe : undefined,
          }
        );
      }
      return json(result);
    }
    if (parsed.data.action === "confirm") {
      const result = await DatabaseProviderService.confirmActivated(
        parsed.data.providerId,
        auth.session.userId
      );
      return json(result);
    }
    const result = await DatabaseProviderService.compareCounts(parsed.data.providerId);
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FAILED";
    return error(msg, 400, msg);
  }
}
