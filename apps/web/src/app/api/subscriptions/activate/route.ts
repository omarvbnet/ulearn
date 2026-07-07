import { SubscriptionService } from "@/services/subscription.service";
import { error, json, requireAuth } from "@/lib/api";
import { z } from "zod";

const schema = z.object({ code: z.string().min(8) });

export async function POST(request: Request) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return error("Invalid code", 400);

  const result = await SubscriptionService.activateWithCode(
    auth.session.userId,
    parsed.data.code.toUpperCase().trim()
  );

  if (!result.success) return error(result.error, 400);
  return json(result);
}
