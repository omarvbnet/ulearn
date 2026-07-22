import { prisma } from "@/lib/prisma";
import {
  generateCertificateNumber,
  generateVerificationCode,
  getLocalizedField,
} from "@/lib/utils";
import { CourseRatingService } from "@/services/course-rating.service";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { LoggingService } from "@/services/logging.service";
import { buildCourseCertificatePdf } from "@/services/course-certificate-pdf.service";
import type { Locale, UserRole } from "@prisma/client";

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://ulearn.usmart-iot.com";
}

function pickTitle(
  course: {
    titleEn: string;
    titleAr: string | null;
    titleKu: string | null;
    titleTr: string | null;
  },
  locale: string
): string {
  return (
    getLocalizedField(course, "title", locale.toLowerCase()) || course.titleEn
  );
}

async function computeTotalHours(courseId: string): Promise<number> {
  const lessons = await prisma.courseLesson.findMany({
    where: { courseId, deletedAt: null, isHidden: false },
    select: { durationSec: true },
  });
  const totalSec = lessons.reduce((s, l) => s + (l.durationSec ?? 0), 0);
  if (totalSec <= 0) return 0;
  return Math.round((totalSec / 3600) * 10) / 10;
}

export class CourseCertificateService {
  /** Status for certificate users only — locked until full course completion. */
  static async getStatus(userId: string, courseId: string, role: UserRole) {
    if (role !== "CERTIFICATE_USER") {
      return {
        eligibleRole: false as const,
        locked: true as const,
        unlocked: false as const,
        reason: "ROLE_NOT_CERTIFICATE_USER" as const,
      };
    }

    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null, status: "APPROVED" },
      include: {
        teacher: {
          select: {
            userId: true,
            user: { select: { fullLegalName: true } },
          },
        },
      },
    });
    if (!course) {
      return {
        eligibleRole: true as const,
        locked: true as const,
        unlocked: false as const,
        reason: "COURSE_NOT_FOUND" as const,
      };
    }

    const purchased = await TeacherCourseService.hasPurchased(courseId, userId);
    const hasAccess =
      purchased || course.teacher.userId === userId || course.price <= 0;

    const completion = await CourseRatingService.getCompletionStatus(
      courseId,
      userId
    );
    const fullyComplete = Boolean(completion?.fullyComplete);
    const existing = await prisma.courseCertificate.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    const totalHours =
      existing?.totalHours ?? (await computeTotalHours(courseId));
    const teacherName =
      existing?.teacherName ??
      course.teacher.user.fullLegalName ??
      "Instructor";

    const preview = {
      courseTitle: pickTitle(course, "en"),
      courseDescription: course.description,
      teacherName,
      totalHours,
      userName: existing?.userName ?? null,
    };

    if (!hasAccess) {
      return {
        eligibleRole: true as const,
        locked: true as const,
        unlocked: false as const,
        reason: "NO_ACCESS" as const,
        completion,
        preview,
        certificate: null,
      };
    }

    if (!fullyComplete) {
      return {
        eligibleRole: true as const,
        locked: true as const,
        unlocked: false as const,
        reason: "COURSE_INCOMPLETE" as const,
        completion,
        preview,
        certificate: null,
      };
    }

    return {
      eligibleRole: true as const,
      locked: false as const,
      unlocked: true as const,
      reason: "READY" as const,
      completion,
      preview: {
        ...preview,
        userName: existing?.userName ?? null,
      },
      certificate: existing
        ? {
            id: existing.id,
            certificateNumber: existing.certificateNumber,
            verificationCode: existing.verificationCode,
            completionDate: existing.completionDate,
            userName: existing.userName,
            courseTitle: existing.courseTitle,
            teacherName: existing.teacherName,
            totalHours: existing.totalHours,
          }
        : null,
    };
  }

  static async claim(userId: string, courseId: string, actorId?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "CERTIFICATE_USER") {
      return { success: false as const, error: "ROLE_NOT_CERTIFICATE_USER" };
    }

    const existing = await prisma.courseCertificate.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) return { success: true as const, certificate: existing };

    const status = await this.getStatus(userId, courseId, user.role);
    if (!status.unlocked) {
      return { success: false as const, error: status.reason };
    }

    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null, status: "APPROVED" },
      include: {
        teacher: {
          select: { user: { select: { fullLegalName: true } } },
        },
      },
    });
    if (!course) return { success: false as const, error: "COURSE_NOT_FOUND" };

    const locale = (user.locale ?? "EN") as Locale;
    const courseTitle = pickTitle(course, locale);
    const teacherName = course.teacher.user.fullLegalName || "Instructor";
    const totalHours = await computeTotalHours(courseId);
    const certificateNumber = generateCertificateNumber();
    const verificationCode = generateVerificationCode();
    const verifyUrl = `${appBaseUrl()}/verify/${verificationCode}`;

    const certificate = await prisma.courseCertificate.create({
      data: {
        userId,
        courseId,
        certificateNumber,
        verificationCode,
        userName: user.fullLegalName || user.phone,
        courseTitle,
        courseDescription: course.description,
        teacherName,
        totalHours,
        completionDate: new Date(),
        qrCodeData: verifyUrl,
      },
    });

    await LoggingService.log({
      actorId: actorId ?? userId,
      action: "GENERATE_COURSE_CERTIFICATE",
      entityType: "CourseCertificate",
      entityId: certificate.id,
      newValue: { certificateNumber, userId, courseId },
    });

    return { success: true as const, certificate };
  }

  static async getPdfBytes(userId: string, courseId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "CERTIFICATE_USER") {
      return { success: false as const, error: "ROLE_NOT_CERTIFICATE_USER" };
    }

    let cert = await prisma.courseCertificate.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (!cert) {
      const claimed = await this.claim(userId, courseId, userId);
      if (!claimed.success) {
        return { success: false as const, error: claimed.error };
      }
      cert = claimed.certificate;
    }

    const bytes = await buildCourseCertificatePdf({
      userName: cert.userName,
      courseTitle: cert.courseTitle,
      courseDescription: cert.courseDescription,
      teacherName: cert.teacherName,
      totalHours: cert.totalHours,
      completionDate: cert.completionDate,
      certificateNumber: cert.certificateNumber,
      verificationUrl:
        cert.qrCodeData || `${appBaseUrl()}/verify/${cert.verificationCode}`,
      locale: user.locale,
    });

    return {
      success: true as const,
      bytes,
      filename: `U-Learn-Certificate-${cert.certificateNumber}.pdf`,
      certificate: cert,
    };
  }

  static async verify(verificationCode: string) {
    return prisma.courseCertificate.findUnique({
      where: { verificationCode },
      include: {
        course: {
          select: {
            titleEn: true,
            titleAr: true,
            titleKu: true,
            titleTr: true,
          },
        },
        user: { select: { fullLegalName: true } },
      },
    });
  }

  static async getUserCertificates(userId: string) {
    return prisma.courseCertificate.findMany({
      where: { userId },
      include: {
        course: {
          select: {
            id: true,
            thumbnail: true,
            titleEn: true,
            titleAr: true,
            titleKu: true,
            titleTr: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
