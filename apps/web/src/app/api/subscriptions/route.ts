import { SubscriptionService } from "@/services/subscription.service";
import { error, json, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { z } from "zod";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  if (!user?.countryId) return error("Country not set", 400);

  const [packages, subscriptions] = await Promise.all([
    SubscriptionService.listPackages(user.countryId),
    SubscriptionService.getUserSubscriptions(user.id),
  ]);

  return json({ packages, subscriptions });
}

export async function POST(request: Request) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const body = await request.json();
  const schema = z.object({ packageId: z.string() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return error("Invalid input", 400);

  const result = await SubscriptionService.requestActivation(
    auth.session.userId,
    parsed.data.packageId
  );

  if (!result.success) return error(result.error, 400);
  return json(result, 201);
}
