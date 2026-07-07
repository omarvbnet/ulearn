import { prisma } from "@/lib/prisma";
import { generateOtp } from "@/lib/utils";
import { createSession, destroySession } from "@/lib/auth/session";
import { LoggingService } from "@/services/logging.service";
import { NotificationService } from "@/services/notification.service";
import type { Gender, Locale, UserRole } from "@prisma/client";

const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

export interface RegisterStudentInput {
  phone: string;
  fullLegalName: string;
  gender: Gender;
  countryId: string;
  provinceId: string;
  email?: string;
  nationalId: string;
  nationalIdImage?: string;
  parentPhone: string;
  latitude?: number;
  longitude?: number;
  locationLabel?: string;
  educationalStageId?: string;
  grade?: string;
  schoolUniversity?: string;
  locale?: Locale;
}

export interface RegisterCertificateInput {
  phone: string;
  fullLegalName: string;
  gender: Gender;
  countryId: string;
  provinceId: string;
  email?: string;
  nationalId: string;
  nationalIdImage?: string;
  latitude?: number;
  longitude?: number;
  locationLabel?: string;
  educationalQualification?: string;
  specialization?: string;
  occupation?: string;
  locale?: Locale;
}

export class AuthService {
  /** Send OTP via WhatsApp (provider integration point). */
  static async sendOtp(phone: string): Promise<{ success: boolean; expiresIn: number }> {
    const normalized = phone.replace(/\s+/g, "");
    const code =
      process.env.NODE_ENV === "development" && process.env.DEV_OTP
        ? process.env.DEV_OTP
        : generateOtp(6);

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

    await prisma.otpCode.create({
      data: { phone: normalized, code, expiresAt },
    });

    await this.dispatchWhatsAppOtp(normalized, code);

    return { success: true, expiresIn: OTP_EXPIRY_MINUTES * 60 };
  }

  private static async dispatchWhatsAppOtp(phone: string, code: string) {
    const { sendWhatsAppOtp } = await import("@/lib/whatsapp");
    try {
      await sendWhatsAppOtp(phone, code);
    } catch (e) {
      console.error("[Auth] WhatsApp OTP dispatch failed:", e);
      if (process.env.NODE_ENV !== "development") {
        throw e;
      }
    }
  }

  static async verifyOtp(
    phone: string,
    code: string,
    meta?: { deviceId?: string; ipAddress?: string; userAgent?: string }
  ) {
    const normalized = phone.replace(/\s+/g, "");

    const otp = await prisma.otpCode.findFirst({
      where: {
        phone: normalized,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) {
      return { success: false as const, error: "OTP_EXPIRED_OR_INVALID" };
    }

    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return { success: false as const, error: "OTP_MAX_ATTEMPTS" };
    }

    if (otp.code !== code) {
      await prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      return { success: false as const, error: "OTP_INVALID" };
    }

    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    const user = await prisma.user.findFirst({
      where: { phone: normalized, deletedAt: null },
    });

    if (!user) {
      return {
        success: true as const,
        isNewUser: true as const,
        phone: normalized,
      };
    }

    if (user.status === "SUSPENDED") {
      return { success: false as const, error: "ACCOUNT_SUSPENDED" };
    }

    if (user.status === "REJECTED") {
      return { success: false as const, error: "ACCOUNT_REJECTED" };
    }

    if (user.status === "PENDING") {
      const token = await createSession(user.id, user.role, user.status, meta);
      return {
        success: true as const,
        isNewUser: false as const,
        isPending: true as const,
        user,
        token,
      };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastActivityAt: new Date() },
    });

    const token = await createSession(user.id, user.role, user.status, meta);

    await LoggingService.log({
      actorId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      success: true as const,
      isNewUser: false as const,
      isPending: false as const,
      user,
      token,
    };
  }

  static async registerStudent(input: RegisterStudentInput, meta?: { ipAddress?: string }) {
    const phone = input.phone.replace(/\s+/g, "");

    const existing = await prisma.user.findFirst({ where: { phone, deletedAt: null } });
    if (existing) {
      return { success: false as const, error: "PHONE_EXISTS" };
    }

    const user = await prisma.user.create({
      data: {
        phone,
        email: input.email,
        fullLegalName: input.fullLegalName,
        gender: input.gender,
        countryId: input.countryId,
        provinceId: input.provinceId,
        nationalId: input.nationalId,
        nationalIdImage: input.nationalIdImage,
        parentPhone: input.parentPhone,
        latitude: input.latitude,
        longitude: input.longitude,
        locationLabel: input.locationLabel,
        role: "STUDENT",
        status: "PENDING",
        locale: input.locale ?? "AR",
        studentProfile: {
          create: {
            educationalStageId: input.educationalStageId,
            grade: input.grade,
            schoolUniversity: input.schoolUniversity,
          },
        },
      },
      include: { studentProfile: true },
    });

    await LoggingService.log({
      actorId: user.id,
      action: "REGISTER",
      entityType: "User",
      entityId: user.id,
      newValue: { role: "STUDENT", phone },
      ipAddress: meta?.ipAddress,
    });

    const token = await createSession(user.id, user.role, user.status);
    return { success: true as const, user, token };
  }

  static async registerCertificateUser(
    input: RegisterCertificateInput,
    meta?: { ipAddress?: string }
  ) {
    const phone = input.phone.replace(/\s+/g, "");

    const existing = await prisma.user.findFirst({ where: { phone, deletedAt: null } });
    if (existing) {
      return { success: false as const, error: "PHONE_EXISTS" };
    }

    const user = await prisma.user.create({
      data: {
        phone,
        email: input.email,
        fullLegalName: input.fullLegalName,
        gender: input.gender,
        countryId: input.countryId,
        provinceId: input.provinceId,
        nationalId: input.nationalId,
        nationalIdImage: input.nationalIdImage,
        latitude: input.latitude,
        longitude: input.longitude,
        locationLabel: input.locationLabel,
        role: "CERTIFICATE_USER",
        status: "PENDING",
        locale: input.locale ?? "AR",
        certificateProfile: {
          create: {
            educationalQualification: input.educationalQualification,
            specialization: input.specialization,
            occupation: input.occupation,
          },
        },
      },
      include: { certificateProfile: true },
    });

    await LoggingService.log({
      actorId: user.id,
      action: "REGISTER",
      entityType: "User",
      entityId: user.id,
      newValue: { role: "CERTIFICATE_USER", phone },
      ipAddress: meta?.ipAddress,
    });

    const token = await createSession(user.id, user.role, user.status);
    return { success: true as const, user, token };
  }

  static async approveUser(userId: string, actorId: string) {
    const previous = await prisma.user.findUnique({ where: { id: userId } });
    if (!previous) return { success: false as const, error: "NOT_FOUND" };

    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "APPROVED" },
    });

    await LoggingService.log({
      actorId,
      action: "APPROVE_USER",
      entityType: "User",
      entityId: userId,
      previousValue: { status: previous.status },
      newValue: { status: "APPROVED" },
    });

    await NotificationService.notifyUser(userId, {
      titleEn: "Account Approved",
      titleAr: "تمت الموافقة على حسابك",
      titleKu: "هەژمارەکەت پەسەند کرا",
      titleTr: "Hesabınız Onaylandı",
      bodyEn: "Your account has been approved. You can now access free lessons.",
      bodyAr: "تمت الموافقة على حسابك. يمكنك الآن الوصول إلى الدروس المجانية.",
      bodyKu: "هەژمارەکەت پەسەند کرا. ئێستا دەتوانیت وانە بەخۆڕاییەکان ببینیت.",
      bodyTr: "Hesabınız onaylandı. Artık ücretsiz derslere erişebilirsiniz.",
    });

    return { success: true as const, user };
  }

  static async suspendUser(userId: string, actorId: string) {
    const previous = await prisma.user.findUnique({ where: { id: userId } });
    if (!previous) return { success: false as const, error: "NOT_FOUND" };

    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "SUSPENDED" },
    });

    await LoggingService.log({
      actorId,
      action: "SUSPEND_USER",
      entityType: "User",
      entityId: userId,
      previousValue: { status: previous.status },
      newValue: { status: "SUSPENDED" },
    });

    return { success: true as const, user };
  }

  static async removeSuspension(userId: string, actorId: string) {
    const previous = await prisma.user.findUnique({ where: { id: userId } });
    if (!previous) return { success: false as const, error: "NOT_FOUND" };

    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "APPROVED" },
    });

    await LoggingService.log({
      actorId,
      action: "REMOVE_SUSPENSION",
      entityType: "User",
      entityId: userId,
      previousValue: { status: previous.status },
      newValue: { status: "APPROVED" },
    });

    return { success: true as const, user };
  }

  static async markInactiveUsers(inactivityDays: number) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - inactivityDays);

    const result = await prisma.user.updateMany({
      where: {
        status: "APPROVED",
        role: { in: ["STUDENT", "CERTIFICATE_USER"] },
        OR: [
          { lastActivityAt: { lt: threshold } },
          { lastActivityAt: null, createdAt: { lt: threshold } },
        ],
      },
      data: { status: "INACTIVE" },
    });

    return result.count;
  }

  static async logout() {
    await destroySession();
  }

  static async createStaffUser(params: {
    phone: string;
    fullLegalName: string;
    role: Extract<UserRole, "SUPER_ADMIN" | "COUNTRY_ADMIN" | "TEACHER">;
    countryId?: string;
    provinceId?: string;
    email?: string;
    specializations?: string[];
    subjectIds?: string[];
    actorId: string;
  }) {
    const phone = params.phone.replace(/\s+/g, "");

    const user = await prisma.user.create({
      data: {
        phone,
        fullLegalName: params.fullLegalName,
        email: params.email,
        role: params.role,
        status: "APPROVED",
        countryId: params.countryId,
        provinceId: params.provinceId,
        ...(params.role === "TEACHER"
          ? {
              teacherProfile: {
                create: {
                  countryId: params.countryId,
                  provinceId: params.provinceId,
                  specializations: params.specializations ?? [],
                  subjects: params.subjectIds
                    ? {
                        create: params.subjectIds.map((subjectId) => ({ subjectId })),
                      }
                    : undefined,
                },
              },
            }
          : {}),
      },
      include: { teacherProfile: true },
    });

    await LoggingService.log({
      actorId: params.actorId,
      action: "CREATE_STAFF",
      entityType: "User",
      entityId: user.id,
      newValue: { role: params.role, phone },
    });

    return user;
  }
}
