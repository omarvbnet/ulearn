import { prisma } from "@/lib/prisma";
import { defaultSubscriptionExpiry, generateActivationCode } from "@/lib/utils";
import { LoggingService } from "@/services/logging.service";
import { NotificationService } from "@/services/notification.service";

export class SubscriptionService {
  static async listPackages(countryId: string) {
    return prisma.subscriptionPackage.findMany({
      where: { countryId, isActive: true, deletedAt: null },
      include: { subject: true, stage: true },
      orderBy: { price: "asc" },
    });
  }

  static async requestActivation(userId: string, packageId: string) {
    const existing = await prisma.activationRequest.findFirst({
      where: { userId, packageId, status: "PENDING" },
    });
    if (existing) {
      return { success: false as const, error: "REQUEST_EXISTS" };
    }

    const request = await prisma.activationRequest.create({
      data: { userId, packageId, status: "PENDING" },
    });

    return { success: true as const, request };
  }

  static async rejectRequest(requestId: string, actorId: string, notes?: string) {
    const request = await prisma.activationRequest.findUnique({
      where: { id: requestId },
      include: { user: true },
    });
    if (!request || request.status !== "PENDING") {
      return { success: false as const, error: "INVALID_REQUEST" };
    }

    await prisma.activationRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        notes: notes || request.notes,
        reviewedBy: actorId,
        reviewedAt: new Date(),
      },
    });

    await LoggingService.log({
      actorId,
      action: "REJECT_ACTIVATION_REQUEST",
      entityType: "ActivationRequest",
      entityId: requestId,
      newValue: { userId: request.userId, notes },
    });

    await NotificationService.notifyUser(request.userId, {
      titleEn: "Activation Request Declined",
      titleAr: "تم رفض طلب التفعيل",
      titleKu: "داواکاری چالاککردن ڕەتکرایەوە",
      titleTr: "Aktivasyon Talebi Reddedildi",
      bodyEn: notes || "Your activation request was declined. Contact support for details.",
      bodyAr: notes || "تم رفض طلب التفعيل الخاص بك. تواصل مع الدعم للمزيد من التفاصيل.",
      bodyKu: notes || "داواکاری چالاککردنەکەت ڕەتکرایەوە. بۆ زانیاری زیاتر پەیوەندی بە پشتگیری بکە.",
      bodyTr: notes || "Aktivasyon talebiniz reddedildi. Ayrıntılar için destek ile iletişime geçin.",
    });

    return { success: true as const };
  }

  static async approveRequest(requestId: string, actorId: string, sendAutomatically = false) {
    const request = await prisma.activationRequest.findUnique({
      where: { id: requestId },
      include: { package: true, user: true },
    });
    if (!request || request.status !== "PENDING") {
      return { success: false as const, error: "INVALID_REQUEST" };
    }

    const code = generateActivationCode();

    const activationCode = await prisma.activationCode.create({
      data: {
        requestId,
        code,
        packageId: request.packageId,
        userId: request.userId,
        createdById: actorId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.activationRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", reviewedBy: actorId, reviewedAt: new Date() },
    });

    await LoggingService.log({
      actorId,
      action: "GENERATE_ACTIVATION_CODE",
      entityType: "ActivationCode",
      entityId: activationCode.id,
      newValue: { requestId, userId: request.userId },
    });

    if (sendAutomatically) {
      await NotificationService.notifyUser(request.userId, {
        titleEn: "Activation Code Ready",
        titleAr: "رمز التفعيل جاهز",
        titleKu: "کۆدی چالاککردن ئامادەیە",
        titleTr: "Aktivasyon Kodu Hazır",
        bodyEn: `Your activation code is: ${code}`,
        bodyAr: `رمز التفعيل الخاص بك: ${code}`,
        bodyKu: `کۆدی چالاککردنت: ${code}`,
        bodyTr: `Aktivasyon kodunuz: ${code}`,
      });
    }

    return { success: true as const, code: activationCode };
  }

  static async activateWithCode(userId: string, code: string) {
    const activation = await prisma.activationCode.findUnique({ where: { code } });
    if (!activation) return { success: false as const, error: "INVALID_CODE" };
    if (activation.usedAt) return { success: false as const, error: "CODE_USED" };
    if (activation.expiresAt && activation.expiresAt < new Date()) {
      return { success: false as const, error: "CODE_EXPIRED" };
    }
    if (activation.userId && activation.userId !== userId) {
      return { success: false as const, error: "CODE_NOT_FOR_USER" };
    }

    const packageId = activation.packageId;
    if (!packageId) return { success: false as const, error: "NO_PACKAGE" };

    const pkg = await prisma.subscriptionPackage.findUnique({ where: { id: packageId } });
    if (!pkg) return { success: false as const, error: "PACKAGE_NOT_FOUND" };

    const expiresAt = await this.resolveExpiry(userId, pkg.durationDays);

    const subscription = await prisma.subscription.create({
      data: {
        userId,
        packageId,
        status: "ACTIVE",
        startsAt: new Date(),
        expiresAt,
        deviceLimit: pkg.deviceLimit,
        activatedBy: "CODE",
      },
    });

    await prisma.activationCode.update({
      where: { id: activation.id },
      data: { usedAt: new Date(), userId },
    });

    if (activation.requestId) {
      await prisma.activationRequest.update({
        where: { id: activation.requestId },
        data: { status: "APPROVED" },
      });
    }

    await LoggingService.log({
      actorId: userId,
      action: "ACTIVATE_SUBSCRIPTION",
      entityType: "Subscription",
      entityId: subscription.id,
      newValue: { packageId, expiresAt: expiresAt.toISOString() },
    });

    return { success: true as const, subscription };
  }

  static async resolveExpiry(userId: string, durationDays?: number | null): Promise<Date> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const excludeCert = await prisma.systemSetting.findFirst({
      where: { key: "exclude_certificate_from_global_expiry" },
    });

    if (user?.role === "CERTIFICATE_USER" && excludeCert?.value === true) {
      const days = durationDays ?? 365;
      return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const globalExpiry = await prisma.systemSetting.findFirst({
      where: { key: "global_subscription_expiry" },
    });

    if (globalExpiry?.value && typeof globalExpiry.value === "string") {
      return new Date(globalExpiry.value);
    }

    return defaultSubscriptionExpiry();
  }

  static async setGlobalExpiry(date: Date, actorId: string, excludeCertificate = true) {
    await prisma.systemSetting.upsert({
      where: { countryId_key: { countryId: "", key: "global_subscription_expiry" } },
      create: {
        key: "global_subscription_expiry",
        value: date.toISOString(),
        updatedBy: actorId,
      },
      update: { value: date.toISOString(), updatedBy: actorId },
    }).catch(async () => {
      // countryId is optional/nullable unique — handle null country
      const existing = await prisma.systemSetting.findFirst({
        where: { key: "global_subscription_expiry", countryId: null },
      });
      if (existing) {
        await prisma.systemSetting.update({
          where: { id: existing.id },
          data: { value: date.toISOString(), updatedBy: actorId },
        });
      } else {
        await prisma.systemSetting.create({
          data: {
            key: "global_subscription_expiry",
            value: date.toISOString(),
            updatedBy: actorId,
          },
        });
      }
    });

    await prisma.systemSetting.upsert({
      where: {
        countryId_key: { countryId: "", key: "exclude_certificate_from_global_expiry" },
      },
      create: {
        key: "exclude_certificate_from_global_expiry",
        value: excludeCertificate,
        updatedBy: actorId,
      },
      update: { value: excludeCertificate, updatedBy: actorId },
    }).catch(async () => {
      const existing = await prisma.systemSetting.findFirst({
        where: { key: "exclude_certificate_from_global_expiry", countryId: null },
      });
      if (existing) {
        await prisma.systemSetting.update({
          where: { id: existing.id },
          data: { value: excludeCertificate, updatedBy: actorId },
        });
      } else {
        await prisma.systemSetting.create({
          data: {
            key: "exclude_certificate_from_global_expiry",
            value: excludeCertificate,
            updatedBy: actorId,
          },
        });
      }
    });

    await prisma.subscription.updateMany({
      where: {
        status: "ACTIVE",
        ...(excludeCertificate
          ? { user: { role: { not: "CERTIFICATE_USER" } } }
          : {}),
      },
      data: { expiresAt: date },
    });

    await LoggingService.log({
      actorId,
      action: "SET_GLOBAL_EXPIRY",
      entityType: "SystemSetting",
      newValue: { date: date.toISOString(), excludeCertificate },
    });
  }

  static async extendSubscription(subscriptionId: string, expiresAt: Date, actorId: string) {
    const previous = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    const sub = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { expiresAt, status: "ACTIVE" },
    });

    await LoggingService.log({
      actorId,
      action: "EXTEND_SUBSCRIPTION",
      entityType: "Subscription",
      entityId: subscriptionId,
      previousValue: { expiresAt: previous?.expiresAt?.toISOString() },
      newValue: { expiresAt: expiresAt.toISOString() },
    });

    return sub;
  }

  /** Admin cancels an active (or pending) subscription — AI or subject/stage package. */
  static async cancelSubscription(subscriptionId: string, actorId: string) {
    const previous = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        package: { select: { type: true, nameEn: true } },
        user: { select: { id: true, fullLegalName: true } },
      },
    });
    if (!previous) {
      return { success: false as const, error: "NOT_FOUND" };
    }
    if (previous.status === "CANCELLED") {
      return { success: false as const, error: "ALREADY_CANCELLED" };
    }

    const sub = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "CANCELLED", expiresAt: new Date() },
    });

    await LoggingService.log({
      actorId,
      action: "CANCEL_SUBSCRIPTION",
      entityType: "Subscription",
      entityId: subscriptionId,
      previousValue: {
        status: previous.status,
        expiresAt: previous.expiresAt?.toISOString() ?? null,
        packageType: previous.package.type,
      },
      newValue: { status: "CANCELLED", userId: previous.userId },
    });

    await NotificationService.notifyUser(previous.userId, {
      titleEn: "Subscription cancelled",
      titleAr: "تم إلغاء الاشتراك",
      titleKu: "بەشداریکردن هەڵوەشایەوە",
      titleTr: "Abonelik iptal edildi",
      bodyEn: `Your subscription to "${previous.package.nameEn}" was cancelled by admin.`,
      bodyAr: `تم إلغاء اشتراكك في "${previous.package.nameEn}" بواسطة المسؤول.`,
      bodyKu: `بەشداریکردنت بۆ "${previous.package.nameEn}" لەلایەن ئەدمینەوە هەڵوەشایەوە.`,
      bodyTr: `"${previous.package.nameEn}" aboneliğiniz yönetici tarafından iptal edildi.`,
    }).catch(() => {});

    return { success: true as const, subscription: sub };
  }

  /** List active subscriptions for admin management (optional package type filter). */
  static async listActiveSubscriptions(opts?: {
    packageType?: string;
    q?: string;
    take?: number;
  }) {
    const q = opts?.q?.trim();
    return prisma.subscription.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(opts?.packageType
          ? { package: { type: opts.packageType as never, deletedAt: null } }
          : { package: { deletedAt: null } }),
        ...(q
          ? {
              user: {
                OR: [
                  { fullLegalName: { contains: q, mode: "insensitive" as const } },
                  { phone: { contains: q } },
                ],
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts?.take ?? 200,
      include: {
        user: {
          select: { id: true, fullLegalName: true, phone: true },
        },
        package: {
          select: {
            id: true,
            type: true,
            nameEn: true,
            price: true,
            currency: true,
          },
        },
      },
    });
  }

  static async expireDueSubscriptions() {
    const result = await prisma.subscription.updateMany({
      where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED" },
    });
    return result.count;
  }

  static async getUserSubscriptions(userId: string) {
    return prisma.subscription.findMany({
      where: { userId },
      include: { package: { include: { subject: true, stage: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  static async listPendingRequests(countryId?: string) {
    return prisma.activationRequest.findMany({
      where: {
        status: "PENDING",
        ...(countryId
          ? { package: { countryId } }
          : {}),
      },
      include: {
        user: { select: { id: true, fullLegalName: true, phone: true } },
        package: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }
}
