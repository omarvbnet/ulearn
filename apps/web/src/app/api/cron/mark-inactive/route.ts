import { AuthService } from "@/services/auth.service";
import { prisma } from "@/lib/prisma";
import { error, json } from "@/lib/api";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    return error("Unauthorized", 401);
  }

  const setting = await prisma.systemSetting.findFirst({
    where: { key: "inactivity_days" },
  });
  const days = typeof setting?.value === "number" ? setting.value : 30;
  const count = await AuthService.markInactiveUsers(days);
  const purged = await AuthService.purgeScheduledDeletions(7);
  return json({ markedInactive: count, days, purgedScheduledDeletions: purged });
}
