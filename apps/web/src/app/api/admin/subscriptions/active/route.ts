import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { SubscriptionService } from "@/services/subscription.service";
import { z } from "zod";

/** Admin: list active subscriptions (AI + subject/stage packages). */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const packageType = searchParams.get("type") || undefined;
  const q = searchParams.get("q") || undefined;

  const subscriptions = await SubscriptionService.listActiveSubscriptions({
    packageType,
    q,
  });

  return json({ subscriptions });
}

const cancelSchema = z.object({
  subscriptionId: z.string().min(1),
});

/** Admin: cancel an active subscription for any user. */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = cancelSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await SubscriptionService.cancelSubscription(
    parsed.data.subscriptionId,
    auth.session.userId
  );
  if (!result.success) return error(result.error, 400, result.error);
  return json(result);
}
