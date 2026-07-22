import { json, requireAuth } from "@/lib/api";
import { AiAnalyticsService } from "@/services/ai";

export async function GET(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(request.url);
  const days = Math.min(Number(searchParams.get("days") || 30), 90);
  const summary = await AiAnalyticsService.usageSummary(days);
  return json(summary);
}
