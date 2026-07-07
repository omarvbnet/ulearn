import { SubscriptionService } from "@/services/subscription.service";
import { error, json, requireAuth } from "@/lib/api";
import { z } from "zod";

export async function GET() {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const requests = await SubscriptionService.listPendingRequests();
  return json({ requests });
}

export async function POST(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const body = await request.json();
  const schema = z.object({
    requestId: z.string(),
    sendAutomatically: z.boolean().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return error("Invalid input", 400);

  const result = await SubscriptionService.approveRequest(
    parsed.data.requestId,
    auth.session.userId,
    parsed.data.sendAutomatically ?? false
  );

  if (!result.success) return error(result.error, 400);
  return json(result);
}
