import { AnalyticsService } from "@/services/analytics.service";
import { json, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  const rankings = await AnalyticsService.getRankings(user?.countryId ?? undefined);
  return json(rankings);
}
