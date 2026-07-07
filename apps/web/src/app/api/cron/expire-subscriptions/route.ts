import { SubscriptionService } from "@/services/subscription.service";
import { error, json } from "@/lib/api";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    return error("Unauthorized", 401);
  }

  const count = await SubscriptionService.expireDueSubscriptions();
  return json({ expired: count });
}
