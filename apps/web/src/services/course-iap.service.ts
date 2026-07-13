import { prisma } from "@/lib/prisma";
import { LoggingService } from "@/services/logging.service";
import { NotificationService } from "@/services/notification.service";
import { TeacherCourseService } from "@/services/teacher-course.service";

export type CourseIapPlatform = "APPLE" | "GOOGLE";

export type CourseIapVerifyInput = {
  userId: string;
  courseId: string;
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
  static async verifyAndActivate(input: CourseIapVerifyInput) {
    const course = await prisma.course.findFirst({
      where: { id: input.courseId, status: "APPROVED", deletedAt: null },
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
    const productOk =
      !expectedId ||
      expectedId === input.productId ||
      input.productId.toLowerCase().includes("course") ||
      input.productId.includes(course.id.slice(0, 8));
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

    await this.verifyWithStore(input);

    const months = course.accessMonths > 0 ? course.accessMonths : 10;
    const expiresAt = addMonths(new Date(), months);
    const level = course.teacher.level;
    const deductionPct = await TeacherCourseService.getDeductionPct(level);
    const platformAmount = Math.round(course.price * deductionPct) / 100;
    const teacherAmount =
      Math.round(course.price * (100 - deductionPct)) / 100;

    const existing = await prisma.coursePurchase.findUnique({
      where: {
        courseId_userId: { courseId: input.courseId, userId: input.userId },
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
            courseId: input.courseId,
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
        courseId: input.courseId,
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
      for (const url of [
        "https://buy.itunes.apple.com/verifyReceipt",
        "https://sandbox.itunes.apple.com/verifyReceipt",
      ]) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            "receipt-data": receipt,
            password: sharedSecret,
            "exclude-old-transactions": true,
          }),
        });
        const data = (await res.json()) as { status?: number };
        if (data.status === 21007) continue;
        if (data.status !== 0) {
          throw new Error(`Apple receipt invalid (status ${data.status})`);
        }
        return;
      }
      throw new Error("Apple receipt verification failed");
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
