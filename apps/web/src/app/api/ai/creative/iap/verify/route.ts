import { error, json, requireAuth } from "@/lib/api";
import { AiIapService } from "@/services/ai/creative/iap.service";
import { z } from "zod";

const CREATIVE_ROLES = ["STUDENT", "CERTIFICATE_USER"] as const;

const schema = z.object({
  platform: z.enum(["APPLE", "GOOGLE"]),
  productId: z.string().min(1).max(200),
  transactionId: z.string().min(1).max(200),
  purchaseToken: z.string().min(1).max(8000),
  receiptData: z.string().max(200_000).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth([...CREATIVE_ROLES]);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await AiIapService.verifyAndActivate({
      userId: auth.session.userId,
      ...parsed.data,
    });
    return json({
      ok: true,
      alreadyProcessed: result.alreadyProcessed,
      status: result.status,
      subscriptionId: result.subscription?.id ?? result.purchase.subscriptionId,
    });
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "IAP verification failed",
      402,
      "AI_IAP_FAILED"
    );
  }
}
