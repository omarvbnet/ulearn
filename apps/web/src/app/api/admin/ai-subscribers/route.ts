import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import {
  AiCreativeEntitlementService,
  type AiCreativePlanLabel,
} from "@/services/ai/creative";

export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const provinceId = searchParams.get("provinceId") || undefined;
  const planFilter = searchParams.get("plan") || undefined;
  const q = searchParams.get("q")?.trim() || undefined;

  const [config, provinces] = await Promise.all([
    AiCreativeEntitlementService.getConfig(),
    prisma.province.findMany({
      orderBy: { nameEn: "asc" },
      select: { id: true, nameEn: true, nameAr: true },
    }),
  ]);

  const [subUserIds, jobUserIds] = await Promise.all([
    prisma.subscription.findMany({
      where: {
        package: { type: "AI_CREATIVE", deletedAt: null },
      },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.aiCreativeJob.findMany({
      where: { status: "SUCCEEDED" },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  const userIdSet = new Set([
    ...subUserIds.map((s) => s.userId),
    ...jobUserIds.map((j) => j.userId),
  ]);

  if (userIdSet.size === 0) {
    return json({ subscribers: [], provinces, config });
  }

  const users = await prisma.user.findMany({
    where: {
      id: { in: [...userIdSet] },
      ...(provinceId ? { provinceId } : {}),
      ...(q
        ? {
            OR: [
              { fullLegalName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      fullLegalName: true,
      phone: true,
      provinceId: true,
      province: { select: { id: true, nameEn: true, nameAr: true } },
      subscriptions: {
        where: {
          status: "ACTIVE",
          package: { type: "AI_CREATIVE", deletedAt: null },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: {
          package: { select: { id: true, nameEn: true, durationDays: true } },
        },
        orderBy: { expiresAt: "desc" },
        take: 1,
      },
      _count: {
        select: {
          coursePurchases: {
            where: { status: "PAID" },
          },
          aiCreativeJobs: {
            where: { status: "SUCCEEDED", countedAsUse: true },
          },
        },
      },
    },
    orderBy: { fullLegalName: "asc" },
  });

  const subscribers = users
    .map((u) => {
      const sub = u.subscriptions[0] ?? null;
      const used = u._count.aiCreativeJobs;
      const courseCount = u._count.coursePurchases;
      let plan: AiCreativePlanLabel = "FREE";
      if (sub) {
        plan = sub.package.nameEn || "MONTHLY";
      } else if (courseCount >= config.courseUnlockCount) {
        plan = "COURSES_UNLOCK";
      }
      return {
        id: u.id,
        name: u.fullLegalName,
        phone: u.phone,
        provinceId: u.provinceId,
        province: u.province?.nameEn ?? null,
        plan,
        used,
        remaining: Math.max(0, config.freeUses - used),
        freeUses: config.freeUses,
        courseCount,
        unlockCount: config.courseUnlockCount,
        expiresAt: sub?.expiresAt?.toISOString() ?? null,
        packageName: sub?.package.nameEn ?? null,
        subscriptionId: sub?.id ?? null,
      };
    })
    .filter((s) => {
      if (!planFilter) return true;
      if (planFilter === "FREE") return s.plan === "FREE";
      if (planFilter === "COURSES_UNLOCK") return s.plan === "COURSES_UNLOCK";
      if (planFilter === "MONTHLY") {
        return s.plan !== "FREE" && s.plan !== "COURSES_UNLOCK";
      }
      return String(s.plan).toLowerCase().includes(planFilter.toLowerCase());
    });

  return json({ subscribers, provinces, config });
}
