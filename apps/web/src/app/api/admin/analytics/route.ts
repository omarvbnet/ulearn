import { AnalyticsService } from "@/services/analytics.service";
import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  let countryId = new URL(request.url).searchParams.get("countryId") || undefined;

  if (auth.session.role === "COUNTRY_ADMIN") {
    const admin = await prisma.user.findUnique({
      where: { id: auth.session.userId },
      select: { countryId: true },
    });
    countryId = admin?.countryId ?? undefined;
  }

  const stats = await AnalyticsService.getDashboardStats(countryId);
  return json(stats);
}
