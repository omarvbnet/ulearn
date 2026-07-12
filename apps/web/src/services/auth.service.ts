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
  nationalIdImage: string;
  parentPhone: string;
  parentEmail?: string;
  latitude?: number;
  longitude?: number;
  locationLabel?: string;
  educationalStageId: string;
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
  nationalIdImage: string;
  latitude?: number;
  longitude?: number;
  locationLabel?: string;
  educationalQualification?: string;
  specialization?: string;
  occupation?: string;
  /** Areas of interest (subjects under a certificate-track stage). Required: 1–5. */
  interestSubjectIds: string[];
  locale?: Locale;
}

export class AuthService {
  /** Send OTP via WhatsApp (provider integration point). */
  static async sendOtp(phone: string): Promise<{ success: boolean; expiresIn: number }> {
    const normalized = phone.replace(/\s+/g, "");
    // Use the fixed DEV_OTP whenever WhatsApp delivery is not configured —
    // otherwise a random code would be generated that nobody ever receives.
    const whatsappConfigured = Boolean(
      process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN
    );
    const code =
      !whatsappConfigured && process.env.DEV_OTP ? process.env.DEV_OTP : generateOtp(6);

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

    // Enforce the subscription device limit for approved students/cert users.
    if (meta?.deviceId && (user.role === "STUDENT" || user.role === "CERTIFICATE_USER")) {
      const { DeviceService } = await import("@/services/device.service");
      const device = await DeviceService.registerDevice(user.id, meta.deviceId, {
        deviceName: meta.userAgent?.slice(0, 120),
      });
      if (!device.allowed) {
        return { success: false as const, error: "DEVICE_LIMIT_REACHED" };
      }
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
        parentEmail: input.parentEmail,
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
    const interestIds = [...new Set(input.interestSubjectIds.filter(Boolean))];
    if (interestIds.length < 1 || interestIds.length > 5) {
      return { success: false as const, error: "INTERESTS_REQUIRED" };
    }

    const interests = await prisma.subject.findMany({
      where: {
        id: { in: interestIds },
        deletedAt: null,
        isActive: true,
        stage: { isCertificateTrack: true, deletedAt: null },
      },
      select: { id: true },
    });
    if (interests.length !== interestIds.length) {
      return { success: false as const, error: "INVALID_INTERESTS" };
    }

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
            interests: {
              create: interestIds.map((subjectId) => ({ subjectId })),
            },
          },
        },
      },
      include: {
        certificateProfile: {
          include: {
            interests: {
              include: {
                subject: {
                  select: {
                    id: true,
                    nameEn: true,
                    nameAr: true,
                    nameKu: true,
                    nameTr: true,
                    stageId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    await LoggingService.log({
      actorId: user.id,
      action: "REGISTER",
      entityType: "User",
      entityId: user.id,
      newValue: { role: "CERTIFICATE_USER", phone, interestSubjectIds: interestIds },
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

  static async rejectUser(userId: string, actorId: string, reason?: string) {
    const previous = await prisma.user.findUnique({ where: { id: userId } });
    if (!previous) return { success: false as const, error: "NOT_FOUND" };

    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "REJECTED" },
    });

    await LoggingService.log({
      actorId,
      action: "REJECT_USER",
      entityType: "User",
      entityId: userId,
      previousValue: { status: previous.status },
      newValue: { status: "REJECTED", reason },
    });

    await NotificationService.notifyUser(userId, {
      titleEn: "Registration Rejected",
      titleAr: "تم رفض التسجيل",
      titleKu: "تۆمارکردن ڕەتکرایەوە",
      titleTr: "Kayıt Reddedildi",
      bodyEn: reason || "Your registration was not approved. Contact support for details.",
      bodyAr: reason || "لم تتم الموافقة على تسجيلك. تواصل مع الدعم للمزيد من التفاصيل.",
      bodyKu: reason || "تۆمارکردنەکەت پەسەند نەکرا. بۆ زانیاری زیاتر پەیوەندی بە پشتگیری بکە.",
      bodyTr: reason || "Kaydınız onaylanmadı. Ayrıntılar için destek ile iletişime geçin.",
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

    const where = {
      status: "APPROVED" as const,
      role: { in: ["STUDENT", "CERTIFICATE_USER"] as UserRole[] },
      OR: [
        { lastActivityAt: { lt: threshold } },
        { lastActivityAt: null, createdAt: { lt: threshold } },
      ],
    };

    const users = await prisma.user.findMany({ where, select: { id: true } });
    if (users.length === 0) return 0;

    await prisma.user.updateMany({ where, data: { status: "INACTIVE" } });

    // Nudge each user so they can come back (in-app + push + email).
    for (const { id } of users) {
      await NotificationService.notifyUser(id, {
        titleEn: "We miss you at U Learn",
        titleAr: "اشتقنا لك في يو ليرن",
        titleKu: "بیرت دەکەین لە یو لێرن",
        titleTr: "U Learn'de seni özledik",
        bodyEn: `You have been inactive for ${inactivityDays} days. Log in to continue learning.`,
        bodyAr: `لم تسجل أي نشاط منذ ${inactivityDays} يوماً. سجّل الدخول لمتابعة التعلم.`,
        bodyKu: `ماوەی ${inactivityDays} ڕۆژە چالاک نیت. بچۆ ژوورەوە بۆ بەردەوامبوون لە فێربوون.`,
        bodyTr: `${inactivityDays} gündür aktif değilsiniz. Öğrenmeye devam etmek için giriş yapın.`,
      }).catch(() => {});
    }

    return users.length;
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
