import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const AI_CREATIVE_CONFIG_KEY = "ai_creative_config";

export type AiCreativeOffer = {
  id: string;
  label: string;
  price: number;
  durationDays: number;
  active: boolean;
  /** Optional linked SubscriptionPackage id */
  packageId?: string;
};

export type AiCreativeConfig = {
  freeUses: number;
  /** Paid store courses required to unlock AI without IAP. */
  courseUnlockCount: number;
  /** @deprecated Prefer monthlyUsd — kept for older clients. */
  monthlyPrice: number;
  /** @deprecated Prefer monthlyUsd / yearlyIqd. */
  currency: string;
  /** Monthly AI plan price in USD (Apple / Play IAP). */
  monthlyUsd: number;
  /** Yearly AI plan price in IQD (Apple / Play IAP). */
  yearlyIqd: number;
  appleProductIdMonthly: string;
  appleProductIdYearly: string;
  googleProductIdMonthly: string;
  googleProductIdYearly: string;
  /** User AI messages before this date do not consume free uses. */
  meteringStartedAt: string;
  offers: AiCreativeOffer[];
};

export const DEFAULT_AI_CREATIVE_CONFIG: AiCreativeConfig = {
  freeUses: 5,
  courseUnlockCount: 6,
  monthlyPrice: 4.99,
  currency: "USD",
  monthlyUsd: 4.99,
  yearlyIqd: 60000,
  appleProductIdMonthly: "com.ulearn.ai.monthly",
  appleProductIdYearly: "com.ulearn.ai.yearly",
  googleProductIdMonthly: "ai_monthly",
  googleProductIdYearly: "ai_yearly",
  meteringStartedAt: "2026-07-13T00:00:00.000Z",
  offers: [],
};

export type AiCreativeAccessReason =
  | "SUBSCRIPTION"
  | "COURSES_UNLOCK"
  | "FREE"
  | "NONE";

export type AiCreativePlanLabel =
  | "FREE"
  | "COURSES_UNLOCK"
  | "MONTHLY"
  | "YEARLY"
  | string;

export type AiCreativeEntitlementStatus = {
  access: boolean;
  reason: AiCreativeAccessReason;
  plan: AiCreativePlanLabel;
  freeUses: number;
  used: number;
  remaining: number;
  courseCount: number;
  unlockCount: number;
  /** True when paid course count already unlocks AI (no IAP required). */
  hasCourseOffer: boolean;
  monthlyPrice: number;
  currency: string;
  monthlyUsd: number;
  yearlyIqd: number;
  appleProductIdMonthly: string;
  appleProductIdYearly: string;
  googleProductIdMonthly: string;
  googleProductIdYearly: string;
  offers: AiCreativeOffer[];
  subscription: {
    id: string;
    packageId: string;
    packageName: string;
    expiresAt: string | null;
  } | null;
  packages: Array<{
    id: string;
    nameEn: string;
    nameAr: string;
    nameKu: string;
    nameTr: string;
    price: number;
    currency: string;
    durationDays: number | null;
  }>;
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function parseConfig(value: unknown): AiCreativeConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_AI_CREATIVE_CONFIG };
  const v = value as Record<string, unknown>;
  const offersRaw = Array.isArray(v.offers) ? v.offers : [];
  const monthlyUsd = num(
    v.monthlyUsd,
    typeof v.monthlyPrice === "number" && String(v.currency || "").toUpperCase() === "USD"
      ? (v.monthlyPrice as number)
      : DEFAULT_AI_CREATIVE_CONFIG.monthlyUsd
  );
  const yearlyIqd = num(v.yearlyIqd, DEFAULT_AI_CREATIVE_CONFIG.yearlyIqd);
  return {
    freeUses:
      typeof v.freeUses === "number" && v.freeUses >= 0
        ? Math.floor(v.freeUses)
        : DEFAULT_AI_CREATIVE_CONFIG.freeUses,
    courseUnlockCount:
      typeof v.courseUnlockCount === "number" && v.courseUnlockCount >= 0
        ? Math.floor(v.courseUnlockCount)
        : DEFAULT_AI_CREATIVE_CONFIG.courseUnlockCount,
    monthlyPrice: monthlyUsd,
    currency: "USD",
    monthlyUsd,
    yearlyIqd,
    appleProductIdMonthly: str(
      v.appleProductIdMonthly,
      DEFAULT_AI_CREATIVE_CONFIG.appleProductIdMonthly
    ),
    appleProductIdYearly: str(
      v.appleProductIdYearly,
      DEFAULT_AI_CREATIVE_CONFIG.appleProductIdYearly
    ),
    googleProductIdMonthly: str(
      v.googleProductIdMonthly,
      DEFAULT_AI_CREATIVE_CONFIG.googleProductIdMonthly
    ),
    googleProductIdYearly: str(
      v.googleProductIdYearly,
      DEFAULT_AI_CREATIVE_CONFIG.googleProductIdYearly
    ),
    meteringStartedAt: str(
      v.meteringStartedAt,
      DEFAULT_AI_CREATIVE_CONFIG.meteringStartedAt
    ),
    offers: offersRaw
      .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
      .map((o) => ({
        id: String(o.id || crypto.randomUUID()),
        label: String(o.label || "Offer"),
        price: typeof o.price === "number" ? o.price : 0,
        durationDays:
          typeof o.durationDays === "number" && o.durationDays > 0
            ? Math.floor(o.durationDays)
            : 30,
        active: o.active !== false,
        packageId: typeof o.packageId === "string" ? o.packageId : undefined,
      })),
  };
}

export class AiCreativeEntitlementService {
  static async getConfig(countryId?: string | null): Promise<AiCreativeConfig> {
    if (countryId) {
      const countrySetting = await prisma.systemSetting.findFirst({
        where: { key: AI_CREATIVE_CONFIG_KEY, countryId },
      });
      if (countrySetting) return parseConfig(countrySetting.value);
    }
    const globalSetting = await prisma.systemSetting.findFirst({
      where: { key: AI_CREATIVE_CONFIG_KEY, countryId: null },
    });
    return parseConfig(globalSetting?.value);
  }

  static async saveConfig(
    config: AiCreativeConfig,
    updatedBy: string,
    countryId?: string | null
  ) {
    const existing = await prisma.systemSetting.findFirst({
      where: { key: AI_CREATIVE_CONFIG_KEY, countryId: countryId ?? null },
    });
    const value = config as unknown as Prisma.InputJsonValue;
    if (existing) {
      return prisma.systemSetting.update({
        where: { id: existing.id },
        data: { value, updatedBy },
      });
    }
    return prisma.systemSetting.create({
      data: {
        key: AI_CREATIVE_CONFIG_KEY,
        value,
        countryId: countryId ?? null,
        updatedBy,
      },
    });
  }

  static async getStatus(userId: string): Promise<AiCreativeEntitlementStatus> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { countryId: true },
    });
    const config = await this.getConfig(user?.countryId);
    const meteringFrom = new Date(config.meteringStartedAt);
    const meteringOk = !Number.isNaN(meteringFrom.getTime())
      ? meteringFrom
      : new Date(DEFAULT_AI_CREATIVE_CONFIG.meteringStartedAt);

    const [creativeUsed, chatUsed, courseCount, activeSub, packages] =
      await Promise.all([
        prisma.aiCreativeJob.count({
          where: { userId, status: "SUCCEEDED", countedAsUse: true },
        }),
        prisma.aiMessage.count({
          where: {
            userId,
            role: "USER",
            createdAt: { gte: meteringOk },
          },
        }),
        prisma.coursePurchase.count({
          where: {
            userId,
            status: "PAID",
          },
        }),
        prisma.subscription.findFirst({
          where: {
            userId,
            status: "ACTIVE",
            package: { type: "AI_CREATIVE", deletedAt: null },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          include: {
            package: {
              select: {
                id: true,
                nameEn: true,
                durationDays: true,
              },
            },
          },
          orderBy: { expiresAt: "desc" },
        }),
        prisma.subscriptionPackage.findMany({
          where: {
            type: "AI_CREATIVE",
            isActive: true,
            deletedAt: null,
            ...(user?.countryId ? { countryId: user.countryId } : {}),
          },
          orderBy: { price: "asc" },
        }),
      ]);

    const used = creativeUsed + chatUsed;
    const remaining = Math.max(0, config.freeUses - used);
    const offers = config.offers.filter((o) => o.active);
    const hasCourseOffer = courseCount >= config.courseUnlockCount;

    let access = false;
    let reason: AiCreativeAccessReason = "NONE";
    let plan: AiCreativePlanLabel = "FREE";

    if (activeSub) {
      access = true;
      reason = "SUBSCRIPTION";
      const days = activeSub.package.durationDays;
      plan =
        days != null && days >= 300
          ? "YEARLY"
          : days != null && days <= 35
            ? "MONTHLY"
            : activeSub.package.nameEn || "MONTHLY";
    } else if (hasCourseOffer) {
      access = true;
      reason = "COURSES_UNLOCK";
      plan = "COURSES_UNLOCK";
    } else if (remaining > 0) {
      access = true;
      reason = "FREE";
      plan = "FREE";
    }

    return {
      access,
      reason,
      plan,
      freeUses: config.freeUses,
      used,
      remaining,
      courseCount,
      unlockCount: config.courseUnlockCount,
      hasCourseOffer,
      monthlyPrice: config.monthlyUsd,
      currency: "USD",
      monthlyUsd: config.monthlyUsd,
      yearlyIqd: config.yearlyIqd,
      appleProductIdMonthly: config.appleProductIdMonthly,
      appleProductIdYearly: config.appleProductIdYearly,
      googleProductIdMonthly: config.googleProductIdMonthly,
      googleProductIdYearly: config.googleProductIdYearly,
      offers,
      subscription: activeSub
        ? {
            id: activeSub.id,
            packageId: activeSub.packageId,
            packageName: activeSub.package.nameEn,
            expiresAt: activeSub.expiresAt?.toISOString() ?? null,
          }
        : null,
      packages: packages.map((p) => ({
        id: p.id,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        nameKu: p.nameKu,
        nameTr: p.nameTr,
        price: Number(p.price),
        currency: p.currency,
        durationDays: p.durationDays,
      })),
    };
  }

  static async assertCanRun(userId: string): Promise<AiCreativeEntitlementStatus> {
    const status = await this.getStatus(userId);
    if (!status.access) {
      const err = new Error("AI subscription or free plan required") as Error & {
        code: string;
        status: AiCreativeEntitlementStatus;
      };
      err.code = "AI_CREATIVE_ENTITLEMENT";
      err.status = status;
      throw err;
    }
    return status;
  }

  /**
   * Mark a finished job as a free-tier use when the run was allowed via FREE.
   */
  static async recordUse(
    userId: string,
    jobId: string,
    entitlementReason: AiCreativeAccessReason
  ): Promise<void> {
    if (entitlementReason !== "FREE") return;

    await prisma.aiCreativeJob.updateMany({
      where: { id: jobId, userId, countedAsUse: false, status: "SUCCEEDED" },
      data: { countedAsUse: true },
    });
  }
}
