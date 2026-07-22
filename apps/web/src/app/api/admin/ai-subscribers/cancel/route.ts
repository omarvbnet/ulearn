import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { SubscriptionService } from "@/services/subscription.service";
import { z } from "zod";

const cancelSchema = z.object({
  userId: z.string().min(1).optional(),
  subscriptionId: z.string().min(1).optional(),
});

/**
 * Admin: cancel a user's active AI Creative subscription.
 * Pass subscriptionId, or userId to cancel all active AI_CREATIVE subs for that user.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = cancelSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { userId, subscriptionId } = parsed.data;
  if (!userId && !subscriptionId) {
    return error("userId or subscriptionId required", 422, "VALIDATION");
  }

  if (subscriptionId) {
    const result = await SubscriptionService.cancelSubscription(
      subscriptionId,
      auth.session.userId
    );
    if (!result.success) return error(result.error, 400, result.error);
    return json(result);
  }

  const active = await prisma.subscription.findMany({
    where: {
      userId: userId!,
      status: "ACTIVE",
      package: { type: "AI_CREATIVE", deletedAt: null },
    },
    select: { id: true },
  });

  if (active.length === 0) {
    return error("NO_ACTIVE_AI_SUBSCRIPTION", 400, "NO_ACTIVE_AI_SUBSCRIPTION");
  }

  const cancelled = [];
  for (const sub of active) {
    const result = await SubscriptionService.cancelSubscription(
      sub.id,
      auth.session.userId
    );
    if (result.success) cancelled.push(result.subscription);
  }

  return json({ success: true, cancelled: cancelled.length });
}
