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
  courseUnlockCount: number;
  monthlyPrice: number;
  currency: string;
  offers: AiCreativeOffer[];
};

export const DEFAULT_AI_CREATIVE_CONFIG: AiCreativeConfig = {
  freeUses: 5,
  courseUnlockCount: 6,
  monthlyPrice: 15000,
  currency: "IQD",
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
  monthlyPrice: number;
  currency: string;
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

function parseConfig(value: unknown): AiCreativeConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_AI_CREATIVE_CONFIG };
  const v = value as Record<string, unknown>;
  const offersRaw = Array.isArray(v.offers) ? v.offers : [];
  return {
    freeUses:
      typeof v.freeUses === "number" && v.freeUses >= 0
        ? Math.floor(v.freeUses)
        : DEFAULT_AI_CREATIVE_CONFIG.freeUses,
    courseUnlockCount:
      typeof v.courseUnlockCount === "number" && v.courseUnlockCount >= 0
        ? Math.floor(v.courseUnlockCount)
        : DEFAULT_AI_CREATIVE_CONFIG.courseUnlockCount,
    monthlyPrice:
      typeof v.monthlyPrice === "number" && v.monthlyPrice >= 0
        ? v.monthlyPrice
        : DEFAULT_AI_CREATIVE_CONFIG.monthlyPrice,
    currency:
      typeof v.currency === "string" && v.currency.trim()
        ? v.currency.trim()
        : DEFAULT_AI_CREATIVE_CONFIG.currency,
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

    const [used, courseCount, activeSub, packages] = await Promise.all([
      prisma.aiCreativeJob.count({
        where: { userId, status: "SUCCEEDED", countedAsUse: true },
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

    const remaining = Math.max(0, config.freeUses - used);
    const offers = config.offers.filter((o) => o.active);

    let access = false;
    let reason: AiCreativeAccessReason = "NONE";
    let plan: AiCreativePlanLabel = "FREE";

    if (activeSub) {
      access = true;
      reason = "SUBSCRIPTION";
      const days = activeSub.package.durationDays;
      plan =
        days != null && days <= 35
          ? activeSub.package.nameEn || "MONTHLY"
          : activeSub.package.nameEn || "MONTHLY";
    } else if (courseCount >= config.courseUnlockCount) {
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
      monthlyPrice: config.monthlyPrice,
      currency: config.currency,
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
      const err = new Error("AI Creative Studio entitlement required") as Error & {
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
   * Pass the reason from assertCanRun (before the job) so post-success status
   * changes do not skip accounting.
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
