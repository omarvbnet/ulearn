import { error, json, requireAuth } from "@/lib/api";
import { AiCreativeEntitlementService } from "@/services/ai/creative";

const CREATIVE_ROLES = ["STUDENT", "CERTIFICATE_USER"] as const;

export async function GET() {
  const auth = await requireAuth([...CREATIVE_ROLES]);
  if (auth.error) return auth.error;

  const status = await AiCreativeEntitlementService.getStatus(auth.session.userId);
  return json({ status });
}
