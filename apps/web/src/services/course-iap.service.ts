import { prisma } from "@/lib/prisma";
import { assertAppleJwsMatches, isLikelyAppleJws } from "@/lib/apple-iap-receipt";
import { LoggingService } from "@/services/logging.service";
import { NotificationService } from "@/services/notification.service";
import { TeacherCourseService } from "@/services/teacher-course.service";

export type CourseIapPlatform = "APPLE" | "GOOGLE";

export type CourseIapVerifyInput = {
  userId: string;
  /** Optional when productId uniquely identifies the course. */
  courseId?: string;
  platform: CourseIapPlatform;
  productId: string;
  transactionId: string;
  purchaseToken: string;
  receiptData?: string;
};

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + Math.max(1, Math.floor(months)));
  return d;
}

/**
 * Verify Apple/Google IAP for a store course and mark CoursePurchase PAID
 * with expiresAt = now + course.accessMonths.
 */
export class CourseIapService {
  /** Resolve course id from explicit id or App Store / Play product id. */
  static async resolveCourseId(input: {
    courseId?: string;
    platform: CourseIapPlatform;
    productId: string;
  }): Promise<string> {
    if (input.courseId?.trim()) return input.courseId.trim();

    const productId = input.productId.trim();
    const applePrefix = "com.ulearn.mobile.course.";
    if (productId.startsWith(applePrefix)) {
      return productId.slice(applePrefix.length);
    }
    if (productId.startsWith("course_")) {
      return productId.slice("course_".length);
    }

    const course = await prisma.course.findFirst({
      where: {
        deletedAt: null,
        status: "APPROVED",
        OR: [
          { appleProductId: productId },
          { googleProductId: productId },
        ],
      },
      select: { id: true },
    });
    if (!course) {
      throw new Error(`No course mapped to product "${productId}"`);
    }
    return course.id;
  }

  static async verifyAndActivate(input: CourseIapVerifyInput) {
    const courseId = await this.resolveCourseId(input);
    const course = await prisma.course.findFirst({
      where: { id: courseId, status: "APPROVED", deletedAt: null },
      include: { teacher: true },
    });
    if (!course) throw new Error("Course not available");
    if (course.teacher.userId === input.userId) {
      throw new Error("Cannot purchase your own course");
    }

    const expectedId =
      input.platform === "APPLE"
        ? course.appleProductId
        : course.googleProductId;
    const fallbackApple = `com.ulearn.mobile.course.${course.id}`;
    const fallbackGoogle = `course_${course.id}`;
    const productOk =
      !expectedId ||
      expectedId === input.productId ||
      input.productId === fallbackApple ||
      input.productId === fallbackGoogle;
    if (!productOk) {
      throw new Error("Product id does not match this course");
    }

    const existingTx = await prisma.coursePurchase.findFirst({
      where: { iapTransactionId: input.transactionId },
    });
    if (existingTx) {
      return {
        alreadyProcessed: true as const,
        purchase: existingTx,
      };
    }

    await this.verifyWithStore({ ...input, courseId });

    const months = course.accessMonths > 0 ? course.accessMonths : 10;
    const expiresAt = addMonths(new Date(), months);
    const level = course.teacher.level;
    const deductionPct = await TeacherCourseService.getDeductionPct(level);
    const platformAmount = Math.round(course.price * deductionPct) / 100;
    const teacherAmount =
      Math.round(course.price * (100 - deductionPct)) / 100;

    const existing = await prisma.coursePurchase.findUnique({
      where: {
        courseId_userId: { courseId, userId: input.userId },
      },
    });

    const purchase = existing
      ? await prisma.coursePurchase.update({
          where: { id: existing.id },
          data: {
            status: "PAID",
            price: course.price,
            currency: course.currency,
            teacherLevel: level,
            deductionPct,
            platformAmount,
            teacherAmount,
            approvedAt: new Date(),
            approvedById: null,
            expiresAt,
            source: input.platform,
            iapTransactionId: input.transactionId,
          },
        })
      : await prisma.coursePurchase.create({
          data: {
            courseId,
            userId: input.userId,
            price: course.price,
            currency: course.currency,
            status: "PAID",
            teacherLevel: level,
            deductionPct,
            platformAmount,
            teacherAmount,
            approvedAt: new Date(),
            expiresAt,
            source: input.platform,
            iapTransactionId: input.transactionId,
          },
        });

    await LoggingService.log({
      actorId: input.userId,
      action: "COURSE_IAP_ACTIVATE",
      entityType: "CoursePurchase",
      entityId: purchase.id,
      newValue: {
        courseId,
        platform: input.platform,
        productId: input.productId,
        expiresAt: expiresAt.toISOString(),
        months,
      },
    });

    await NotificationService.notifyUser(
      input.userId,
      {
        titleEn: "Course Unlocked",
        titleAr: "تم فتح الدورة",
        titleKu: "کۆرسەکە کرایەوە",
        titleTr: "Kursun Kilidi Açıldı",
        bodyEn: `"${course.titleEn}" is unlocked until ${expiresAt.toLocaleDateString()}.`,
        bodyAr: `"${course.titleEn}" متاحة حتى ${expiresAt.toLocaleDateString()}.`,
        bodyKu: `"${course.titleEn}" تا ${expiresAt.toLocaleDateString()} کراوەیە.`,
        bodyTr: `"${course.titleEn}" ${expiresAt.toLocaleDateString()} tarihine kadar açık.`,
      },
      {
        type: "course",
        courseId: course.id,
        screen: "course",
      }
    ).catch(() => {});

    return { alreadyProcessed: false as const, purchase, expiresAt, months };
  }

  private static async verifyWithStore(input: CourseIapVerifyInput) {
    if (!input.transactionId?.trim() || !input.purchaseToken?.trim()) {
      throw new Error("Missing purchase token or transaction id");
    }
    if (process.env.IAP_SKIP_VERIFY === "true") return;

    if (input.platform === "APPLE") {
      const sharedSecret = process.env.APPLE_IAP_SHARED_SECRET;
      if (!sharedSecret) {
        if (process.env.NODE_ENV !== "production") return;
        throw new Error("Apple IAP is not configured");
      }
      const receipt = input.receiptData || input.purchaseToken;

      // StoreKit 2 JWS fallback (should be rare — mobile forces StoreKit 1).
      if (isLikelyAppleJws(receipt)) {
        const ok = assertAppleJwsMatches(receipt, input);
        if (!ok) throw new Error("Apple JWS does not match this purchase");
        console.info("[course-iap] accepted StoreKit2 JWS for", input.productId);
        return;
      }

      // Production first, then Sandbox (status 21007). Critical for App Review.
      const endpoints = [
        "https://buy.itunes.apple.com/verifyReceipt",
        "https://sandbox.itunes.apple.com/verifyReceipt",
      ];
      let lastStatus = -1;
      for (const url of endpoints) {
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
          environment?: string;
        };
        lastStatus = data.status ?? -1;
        console.info(
          `[course-iap] verifyReceipt ${url} status=${lastStatus} env=${data.environment ?? "?"}`
        );
        if (lastStatus === 21007) continue; // sandbox receipt → retry sandbox
        if (lastStatus === 21008) continue; // prod receipt sent to sandbox
        if (lastStatus !== 0) {
          throw new Error(`Apple receipt invalid (status ${lastStatus})`);
        }
        return;
      }
      throw new Error(`Apple receipt verification failed (status ${lastStatus})`);
    }

    const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
    const accessToken = process.env.GOOGLE_PLAY_ACCESS_TOKEN;
    if (!packageName || !accessToken) {
      if (process.env.NODE_ENV !== "production") return;
      throw new Error("Google Play IAP is not configured");
    }
    const onceUrl =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(packageName)}/purchases/products/` +
      `${encodeURIComponent(input.productId)}/tokens/` +
      `${encodeURIComponent(input.purchaseToken)}`;
    const once = await fetch(onceUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!once.ok) {
      throw new Error(`Google Play verification failed (${once.status})`);
    }
  }
}
