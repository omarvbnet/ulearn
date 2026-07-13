import { prisma } from "@/lib/prisma";
import { SubscriptionService } from "@/services/subscription.service";
import { LoggingService } from "@/services/logging.service";
import {
  AiCreativeEntitlementService,
  type AiCreativeConfig,
} from "./entitlement.service";

export type AiIapPlan = "MONTHLY" | "YEARLY";
export type AiIapPlatform = "APPLE" | "GOOGLE";

export type AiIapVerifyInput = {
  userId: string;
  platform: AiIapPlatform;
  productId: string;
  /** Apple: transactionId / originalTransactionId. Google: orderId. */
  transactionId: string;
  /** Apple: base64 receipt. Google: purchaseToken. */
  purchaseToken: string;
  /** Optional serverVerificationData / receipt blob. */
  receiptData?: string;
};

/**
 * Verify Apple / Google IAP and activate an AI_CREATIVE subscription.
 * Set APPLE_IAP_SHARED_SECRET / GOOGLE_PLAY_PACKAGE_NAME (+ service account)
 * in production. When IAP_SKIP_VERIFY=true, trusts client after basic checks.
 */
export class AiIapService {
  static resolvePlan(
    config: AiCreativeConfig,
    platform: AiIapPlatform,
    productId: string
  ): AiIapPlan | null {
    const id = productId.trim().toLowerCase();
    const monthlyAliases = new Set(
      [
        config.appleProductIdMonthly,
        config.googleProductIdMonthly,
        "com.ulearn.mobile.ai.monthly",
        "com.ulearn.ai.monthly",
        "ai_monthly",
        "ai.monthly",
      ]
        .filter(Boolean)
        .map((s) => s.toLowerCase())
    );
    const yearlyAliases = new Set(
      [
        config.appleProductIdYearly,
        config.googleProductIdYearly,
        "com.ulearn.mobile.ai.yearly",
        "com.ulearn.ai.yearly",
        "ai_yearly",
        "ai.yearly",
      ]
        .filter(Boolean)
        .map((s) => s.toLowerCase())
    );
    if (monthlyAliases.has(id) || id.includes("month")) return "MONTHLY";
    if (yearlyAliases.has(id) || id.includes("year") || id.includes("annual")) {
      return "YEARLY";
    }
    if (platform === "APPLE") {
      if (id === config.appleProductIdMonthly.toLowerCase()) return "MONTHLY";
      if (id === config.appleProductIdYearly.toLowerCase()) return "YEARLY";
    } else {
      if (id === config.googleProductIdMonthly.toLowerCase()) return "MONTHLY";
      if (id === config.googleProductIdYearly.toLowerCase()) return "YEARLY";
    }
    return null;
  }

  static async ensureAiPackage(
    userId: string,
    plan: AiIapPlan,
    config: AiCreativeConfig
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { countryId: true },
    });
    if (!user?.countryId) {
      throw new Error("Country is required before purchasing AI");
    }

    const durationDays = plan === "YEARLY" ? 365 : 30;
    const price = plan === "YEARLY" ? config.yearlyIqd : config.monthlyUsd;
    const currency = plan === "YEARLY" ? "IQD" : "USD";
    const nameEn = plan === "YEARLY" ? "AI Yearly" : "AI Monthly";
    const nameAr = plan === "YEARLY" ? "ذكاء اصطناعي سنوي" : "ذكاء اصطناعي شهري";
    const nameKu = plan === "YEARLY" ? "AI ساڵانە" : "AI مانگانە";
    const nameTr = plan === "YEARLY" ? "YZ Yıllık" : "YZ Aylık";

    const existing = await prisma.subscriptionPackage.findFirst({
      where: {
        countryId: user.countryId,
        type: "AI_CREATIVE",
        durationDays,
        currency,
        deletedAt: null,
        isActive: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) {
      if (Number(existing.price) !== price) {
        return prisma.subscriptionPackage.update({
          where: { id: existing.id },
          data: { price, nameEn, nameAr, nameKu, nameTr },
        });
      }
      return existing;
    }

    return prisma.subscriptionPackage.create({
      data: {
        countryId: user.countryId,
        type: "AI_CREATIVE",
        nameEn,
        nameAr,
        nameKu,
        nameTr,
        description: `In-app purchase (${plan})`,
        price,
        currency,
        durationDays,
        deviceLimit: 2,
        isActive: true,
      },
    });
  }

  static async verifyAndActivate(input: AiIapVerifyInput) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { countryId: true, role: true },
    });
    if (!user) throw new Error("User not found");
    if (user.role !== "STUDENT" && user.role !== "CERTIFICATE_USER") {
      throw new Error("Only learners can purchase AI plans");
    }

    const config = await AiCreativeEntitlementService.getConfig(user.countryId);
    const plan = this.resolvePlan(config, input.platform, input.productId);
    if (!plan) {
      throw new Error("Unknown AI product id");
    }

    const existing = await prisma.aiIapPurchase.findUnique({
      where: { transactionId: input.transactionId },
    });
    if (existing) {
      const status = await AiCreativeEntitlementService.getStatus(input.userId);
      return { alreadyProcessed: true as const, status, purchase: existing };
    }

    await this.verifyWithStore(input, config);

    const pkg = await this.ensureAiPackage(input.userId, plan, config);
    const expiresAt = await SubscriptionService.resolveExpiry(
      input.userId,
      pkg.durationDays
    );

    const subscription = await prisma.subscription.create({
      data: {
        userId: input.userId,
        packageId: pkg.id,
        status: "ACTIVE",
        startsAt: new Date(),
        expiresAt,
        deviceLimit: pkg.deviceLimit,
        activatedBy: `IAP_${input.platform}`,
      },
    });

    const purchase = await prisma.aiIapPurchase.create({
      data: {
        userId: input.userId,
        platform: input.platform,
        productId: input.productId,
        transactionId: input.transactionId,
        purchaseToken: input.purchaseToken,
        plan,
        subscriptionId: subscription.id,
        raw: {
          receiptData: input.receiptData?.slice(0, 4000) || null,
        },
      },
    });

    await LoggingService.log({
      actorId: input.userId,
      action: "AI_IAP_ACTIVATE",
      entityType: "Subscription",
      entityId: subscription.id,
      newValue: {
        platform: input.platform,
        productId: input.productId,
        plan,
        transactionId: input.transactionId,
      },
    });

    const status = await AiCreativeEntitlementService.getStatus(input.userId);
    return { alreadyProcessed: false as const, status, purchase, subscription };
  }

  private static async verifyWithStore(
    input: AiIapVerifyInput,
    _config: AiCreativeConfig
  ) {
    if (!input.transactionId?.trim() || !input.purchaseToken?.trim()) {
      throw new Error("Missing purchase token or transaction id");
    }

    if (process.env.IAP_SKIP_VERIFY === "true") {
      return;
    }

    if (input.platform === "APPLE") {
      await this.verifyApple(input);
      return;
    }
    await this.verifyGoogle(input);
  }

  private static async verifyApple(input: AiIapVerifyInput) {
    const sharedSecret = process.env.APPLE_IAP_SHARED_SECRET;
    if (!sharedSecret) {
      // Without shared secret, accept only when explicitly allowed.
      if (process.env.NODE_ENV !== "production") return;
      throw new Error("Apple IAP is not configured (APPLE_IAP_SHARED_SECRET)");
    }

    const receipt = input.receiptData || input.purchaseToken;
    const bodies = [
      "https://buy.itunes.apple.com/verifyReceipt",
      "https://sandbox.itunes.apple.com/verifyReceipt",
    ];
    let lastStatus = -1;
    for (const url of bodies) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "receipt-data": receipt,
          password: sharedSecret,
          "exclude-old-transactions": true,
        }),
      });
      const data = (await res.json()) as {
        status?: number;
        latest_receipt_info?: Array<{ transaction_id?: string; product_id?: string }>;
        receipt?: {
          in_app?: Array<{ transaction_id?: string; product_id?: string }>;
        };
      };
      lastStatus = data.status ?? -1;
      // 21007 = sandbox receipt sent to production
      if (lastStatus === 21007) continue;
      if (lastStatus !== 0) {
        throw new Error(`Apple receipt invalid (status ${lastStatus})`);
      }
      const rows = [
        ...(data.latest_receipt_info || []),
        ...(data.receipt?.in_app || []),
      ];
      const match = rows.find(
        (r) =>
          r.transaction_id === input.transactionId ||
          r.product_id === input.productId
      );
      if (!match) {
        throw new Error("Apple receipt does not include this transaction");
      }
      return;
    }
    throw new Error(`Apple receipt verification failed (status ${lastStatus})`);
  }

  private static async verifyGoogle(input: AiIapVerifyInput) {
    const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
    const accessToken = process.env.GOOGLE_PLAY_ACCESS_TOKEN;
    if (!packageName || !accessToken) {
      if (process.env.NODE_ENV !== "production") return;
      throw new Error(
        "Google Play IAP is not configured (GOOGLE_PLAY_PACKAGE_NAME / GOOGLE_PLAY_ACCESS_TOKEN)"
      );
    }

    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(packageName)}/purchases/subscriptions/` +
      `${encodeURIComponent(input.productId)}/tokens/` +
      `${encodeURIComponent(input.purchaseToken)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      // Fallback: one-time products endpoint
      const onceUrl =
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
        `${encodeURIComponent(packageName)}/purchases/products/` +
        `${encodeURIComponent(input.productId)}/tokens/` +
        `${encodeURIComponent(input.purchaseToken)}`;
      const once = await fetch(onceUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!once.ok) {
        throw new Error(`Google Play verification failed (${res.status})`);
      }
      const onceData = (await once.json()) as { purchaseState?: number };
      if (onceData.purchaseState != null && onceData.purchaseState !== 0) {
        throw new Error("Google Play purchase is not completed");
      }
      return;
    }
    const data = (await res.json()) as { paymentState?: number };
    if (data.paymentState != null && data.paymentState !== 1 && data.paymentState !== 2) {
      throw new Error("Google Play subscription payment is not active");
    }
  }
}
