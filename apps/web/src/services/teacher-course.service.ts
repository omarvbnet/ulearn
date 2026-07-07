import { prisma } from "@/lib/prisma";
import { LoggingService } from "@/services/logging.service";
import { NotificationService } from "@/services/notification.service";
import type { CourseStatus, TeacherLevel } from "@prisma/client";

/** Minimum student ratings before the level changes automatically. */
const MIN_RATINGS_FOR_AUTO_LEVEL = 5;

/** Platform deduction (%) per teacher level — admin-configurable in settings. */
export const DEDUCTION_SETTING_KEYS: Record<
  Exclude<TeacherLevel, "NEEDS_IMPROVEMENT">,
  string
> = {
  GOOD: "deduction_good",
  EXCELLENT: "deduction_excellent",
  MASTER: "deduction_master",
};

const DEFAULT_DEDUCTIONS: Record<string, number> = {
  deduction_good: 30,
  deduction_excellent: 20,
  deduction_master: 10,
};

export class TeacherCourseService {
  // ── Teacher levels ──────────────────────────────────────────

  static async getDeductionPct(level: TeacherLevel): Promise<number> {
    if (level === "NEEDS_IMPROVEMENT") return 100; // cannot sell anyway
    const key = DEDUCTION_SETTING_KEYS[level];
    const setting = await prisma.systemSetting.findFirst({ where: { key } });
    const value = Number(setting?.value);
    return Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : DEFAULT_DEDUCTIONS[key];
  }

  static levelFromAverage(avg: number): TeacherLevel {
    if (avg >= 4.5) return "MASTER";
    if (avg >= 3.5) return "EXCELLENT";
    if (avg >= 2.5) return "GOOD";
    return "NEEDS_IMPROVEMENT";
  }

  /**
   * Recompute a teacher's level from student ratings.
   * Skipped when an admin has pinned the level manually.
   */
  static async recomputeLevel(teacherId: string) {
    const teacher = await prisma.teacherProfile.findUnique({ where: { id: teacherId } });
    if (!teacher || teacher.levelSetByAdmin) return teacher?.level;

    const agg = await prisma.teacherRating.aggregate({
      where: { teacherId },
      _avg: { rating: true },
      _count: true,
    });

    if (agg._count < MIN_RATINGS_FOR_AUTO_LEVEL || agg._avg.rating == null) {
      return teacher.level;
    }

    const newLevel = this.levelFromAverage(agg._avg.rating);
    if (newLevel !== teacher.level) {
      await this.applyLevel(teacherId, newLevel, null);
    }
    return newLevel;
  }

  /** Admin sets the level manually (or returns it to automatic). */
  static async setLevel(
    teacherId: string,
    actorId: string,
    opts: { level?: TeacherLevel; auto?: boolean }
  ) {
    const teacher = await prisma.teacherProfile.findUnique({ where: { id: teacherId } });
    if (!teacher) return { success: false as const, error: "NOT_FOUND" };

    if (opts.auto) {
      await prisma.teacherProfile.update({
        where: { id: teacherId },
        data: { levelSetByAdmin: false },
      });
      const level = await this.recomputeLevel(teacherId);
      return { success: true as const, level };
    }

    if (!opts.level) return { success: false as const, error: "LEVEL_REQUIRED" };

    await prisma.teacherProfile.update({
      where: { id: teacherId },
      data: { levelSetByAdmin: true },
    });
    await this.applyLevel(teacherId, opts.level, actorId);
    return { success: true as const, level: opts.level };
  }

  /**
   * Persists a level change and applies its side effects:
   * NEEDS_IMPROVEMENT closes all the teacher's live courses;
   * recovering to GOOD+ reopens the ones that were closed by level.
   */
  private static async applyLevel(
    teacherId: string,
    level: TeacherLevel,
    actorId: string | null
  ) {
    const previous = await prisma.teacherProfile.findUnique({
      where: { id: teacherId },
      select: { level: true, userId: true },
    });

    await prisma.teacherProfile.update({
      where: { id: teacherId },
      data: { level, levelUpdatedAt: new Date() },
    });

    if (level === "NEEDS_IMPROVEMENT") {
      await prisma.course.updateMany({
        where: { teacherId, status: "APPROVED", deletedAt: null },
        data: { status: "CLOSED", closedByLevel: true },
      });
    } else {
      await prisma.course.updateMany({
        where: { teacherId, status: "CLOSED", closedByLevel: true, deletedAt: null },
        data: { status: "APPROVED", closedByLevel: false },
      });
    }

    await LoggingService.log({
      actorId: actorId ?? undefined,
      action: "TEACHER_LEVEL_CHANGED",
      entityType: "TeacherProfile",
      entityId: teacherId,
      previousValue: { level: previous?.level },
      newValue: { level, by: actorId ? "admin" : "auto" },
    });

    if (previous?.userId) {
      const label = level.replace(/_/g, " ").toLowerCase();
      await NotificationService.notifyUser(previous.userId, {
        titleEn: "Teacher Level Updated",
        titleAr: "تم تحديث مستواك التعليمي",
        titleKu: "ئاستی مامۆستاییت نوێکرایەوە",
        titleTr: "Öğretmen Seviyeniz Güncellendi",
        bodyEn:
          level === "NEEDS_IMPROVEMENT"
            ? "Your level is now: needs improvement. Your courses are paused until your level returns to Good or higher."
            : `Your teacher level is now: ${label}.`,
        bodyAr:
          level === "NEEDS_IMPROVEMENT"
            ? "مستواك الآن: يحتاج إلى تحسين. تم إيقاف دوراتك حتى يعود مستواك إلى جيد أو أعلى."
            : `مستواك التعليمي الآن: ${label}.`,
        bodyKu:
          level === "NEEDS_IMPROVEMENT"
            ? "ئاستەکەت ئێستا: پێویستی بە باشترکردنە. کۆرسەکانت ڕاگیراون تا ئاستەکەت دەگەڕێتەوە بۆ باش یان سەرووتر."
            : `ئاستی مامۆستاییت ئێستا: ${label}.`,
        bodyTr:
          level === "NEEDS_IMPROVEMENT"
            ? "Seviyeniz şimdi: geliştirilmeli. Seviyeniz İyi veya üzerine dönene kadar kurslarınız durduruldu."
            : `Öğretmen seviyeniz şimdi: ${label}.`,
      }).catch(() => {});
    }
  }

  // ── Courses (teacher side) ──────────────────────────────────

  static async createCourse(
    teacherId: string,
    input: {
      stageId: string;
      subjectId: string;
      titleEn: string;
      titleAr?: string;
      titleKu?: string;
      titleTr?: string;
      description?: string;
      thumbnail?: string;
      price: number;
      currency?: string;
    }
  ) {
    const teacher = await prisma.teacherProfile.findFirst({
      where: { id: teacherId, deletedAt: null },
      include: { subjects: true },
    });
    if (!teacher) return { success: false as const, error: "TEACHER_NOT_FOUND" };
    if (!teacher.isActive) return { success: false as const, error: "TEACHER_BLOCKED" };

    // Courses must match the teacher's assigned specialization subjects.
    const allowed = teacher.subjects.some((s) => s.subjectId === input.subjectId);
    if (!allowed) return { success: false as const, error: "SUBJECT_NOT_ASSIGNED" };

    if (!(input.price >= 0)) return { success: false as const, error: "INVALID_PRICE" };

    const course = await prisma.course.create({
      data: {
        teacherId,
        stageId: input.stageId,
        subjectId: input.subjectId,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        titleKu: input.titleKu,
        titleTr: input.titleTr,
        description: input.description,
        thumbnail: input.thumbnail,
        price: input.price,
        currency: input.currency || "IQD",
        status: "PENDING_REVIEW",
      },
    });

    await LoggingService.log({
      actorId: teacher.userId,
      action: "CREATE_COURSE",
      entityType: "Course",
      entityId: course.id,
      newValue: { titleEn: course.titleEn, price: course.price },
    });

    return { success: true as const, course };
  }

  static async updateCourse(
    teacherId: string,
    courseId: string,
    input: Partial<{
      titleEn: string;
      titleAr: string;
      titleKu: string;
      titleTr: string;
      description: string;
      thumbnail: string;
      price: number;
      stageId: string;
      subjectId: string;
    }>
  ) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, teacherId, deletedAt: null },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" };

    // Any content edit sends the course back to review.
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { ...input, status: "PENDING_REVIEW", reviewedAt: null, reviewNotes: null },
    });
    return { success: true as const, course: updated };
  }

  static async deleteCourse(teacherId: string, courseId: string) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, teacherId, deletedAt: null },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" };

    await prisma.course.update({
      where: { id: courseId },
      data: { deletedAt: new Date() },
    });
    return { success: true as const };
  }

  static async listTeacherCourses(teacherId: string) {
    return prisma.course.findMany({
      where: { teacherId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        stage: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
        subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
        lessons: { orderBy: { sortOrder: "asc" } },
        _count: { select: { purchases: { where: { status: "PAID" } } } },
      },
    });
  }

  /** Teacher earnings summary across paid purchases. */
  static async teacherEarnings(teacherId: string) {
    const purchases = await prisma.coursePurchase.findMany({
      where: { status: "PAID", course: { teacherId } },
      select: { teacherAmount: true, platformAmount: true, price: true, currency: true },
    });
    return {
      sales: purchases.length,
      gross: purchases.reduce((s, p) => s + p.price, 0),
      teacherRevenue: purchases.reduce((s, p) => s + (p.teacherAmount ?? 0), 0),
      platformRevenue: purchases.reduce((s, p) => s + (p.platformAmount ?? 0), 0),
      currency: purchases[0]?.currency ?? "IQD",
    };
  }

  // ── Admin review ────────────────────────────────────────────

  static async reviewCourse(
    courseId: string,
    actorId: string,
    decision: "APPROVED" | "REJECTED",
    notes?: string
  ) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      include: { teacher: true },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" };

    // A blocked teacher or a "needs improvement" level cannot go live.
    let status: CourseStatus = decision;
    let closedByLevel = false;
    if (decision === "APPROVED") {
      if (!course.teacher.isActive) {
        return { success: false as const, error: "TEACHER_BLOCKED" };
      }
      if (course.teacher.level === "NEEDS_IMPROVEMENT") {
        status = "CLOSED";
        closedByLevel = true;
      }
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        status,
        closedByLevel,
        reviewNotes: notes || null,
        reviewedById: actorId,
        reviewedAt: new Date(),
      },
    });

    await LoggingService.log({
      actorId,
      action: `COURSE_${decision}`,
      entityType: "Course",
      entityId: courseId,
      newValue: { status, notes },
    });

    await NotificationService.notifyUser(course.teacher.userId, {
      titleEn: decision === "APPROVED" ? "Course Approved" : "Course Rejected",
      titleAr: decision === "APPROVED" ? "تمت الموافقة على الدورة" : "تم رفض الدورة",
      titleKu: decision === "APPROVED" ? "کۆرسەکە پەسەند کرا" : "کۆرسەکە ڕەتکرایەوە",
      titleTr: decision === "APPROVED" ? "Kurs Onaylandı" : "Kurs Reddedildi",
      bodyEn:
        decision === "APPROVED"
          ? `"${course.titleEn}" is now live for students.`
          : notes || `"${course.titleEn}" was not approved.`,
      bodyAr:
        decision === "APPROVED"
          ? `"${course.titleEn}" أصبحت متاحة للطلاب الآن.`
          : notes || `لم تتم الموافقة على "${course.titleEn}".`,
      bodyKu:
        decision === "APPROVED"
          ? `"${course.titleEn}" ئێستا بۆ خوێندکاران بەردەستە.`
          : notes || `"${course.titleEn}" پەسەند نەکرا.`,
      bodyTr:
        decision === "APPROVED"
          ? `"${course.titleEn}" artık öğrenciler için yayında.`
          : notes || `"${course.titleEn}" onaylanmadı.`,
    }).catch(() => {});

    return { success: true as const, course: updated };
  }

  // ── Student browse & purchase ───────────────────────────────

  /** Courses visible to students: approved, active teacher, level >= GOOD. */
  static async listPublishedCourses(filter?: { stageId?: string; subjectId?: string }) {
    return prisma.course.findMany({
      where: {
        status: "APPROVED",
        deletedAt: null,
        ...(filter?.stageId ? { stageId: filter.stageId } : {}),
        ...(filter?.subjectId ? { subjectId: filter.subjectId } : {}),
        teacher: {
          isActive: true,
          deletedAt: null,
          level: { not: "NEEDS_IMPROVEMENT" },
          user: { status: "APPROVED", deletedAt: null },
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        teacher: {
          select: { id: true, level: true, user: { select: { fullLegalName: true } } },
        },
        stage: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
        subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
        lessons: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, title: true, durationSec: true, isFreePreview: true },
        },
        _count: { select: { purchases: { where: { status: "PAID" } } } },
      },
    });
  }

  static async requestPurchase(courseId: string, userId: string) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, status: "APPROVED", deletedAt: null },
    });
    if (!course) return { success: false as const, error: "COURSE_NOT_AVAILABLE" };

    const existing = await prisma.coursePurchase.findUnique({
      where: { courseId_userId: { courseId, userId } },
    });
    if (existing && existing.status !== "REJECTED") {
      return { success: false as const, error: "ALREADY_REQUESTED" };
    }

    const purchase = existing
      ? await prisma.coursePurchase.update({
          where: { id: existing.id },
          data: { status: "PENDING", price: course.price, currency: course.currency },
        })
      : await prisma.coursePurchase.create({
          data: { courseId, userId, price: course.price, currency: course.currency },
        });

    return { success: true as const, purchase };
  }

  /** Admin confirms payment; snapshots the revenue split by teacher level. */
  static async approvePurchase(purchaseId: string, actorId: string) {
    const purchase = await prisma.coursePurchase.findUnique({
      where: { id: purchaseId },
      include: { course: { include: { teacher: true } } },
    });
    if (!purchase || purchase.status !== "PENDING") {
      return { success: false as const, error: "INVALID_PURCHASE" };
    }

    const level = purchase.course.teacher.level;
    const deductionPct = await this.getDeductionPct(level);
    const platformAmount = Math.round(purchase.price * deductionPct) / 100;
    const teacherAmount = Math.round(purchase.price * (100 - deductionPct)) / 100;

    const updated = await prisma.coursePurchase.update({
      where: { id: purchaseId },
      data: {
        status: "PAID",
        teacherLevel: level,
        deductionPct,
        platformAmount,
        teacherAmount,
        approvedById: actorId,
        approvedAt: new Date(),
      },
    });

    await LoggingService.log({
      actorId,
      action: "APPROVE_COURSE_PURCHASE",
      entityType: "CoursePurchase",
      entityId: purchaseId,
      newValue: { level, deductionPct, platformAmount, teacherAmount },
    });

    await NotificationService.notifyUser(purchase.userId, {
      titleEn: "Course Unlocked",
      titleAr: "تم فتح الدورة",
      titleKu: "کۆرسەکە کرایەوە",
      titleTr: "Kursun Kilidi Açıldı",
      bodyEn: `Your payment was confirmed. "${purchase.course.titleEn}" is now available.`,
      bodyAr: `تم تأكيد الدفع. "${purchase.course.titleEn}" متاحة الآن.`,
      bodyKu: `پارەدانەکەت پشتڕاست کرایەوە. "${purchase.course.titleEn}" ئێستا بەردەستە.`,
      bodyTr: `Ödemeniz onaylandı. "${purchase.course.titleEn}" artık kullanılabilir.`,
    }).catch(() => {});

    return { success: true as const, purchase: updated };
  }

  static async rejectPurchase(purchaseId: string, actorId: string) {
    const purchase = await prisma.coursePurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.status !== "PENDING") {
      return { success: false as const, error: "INVALID_PURCHASE" };
    }
    await prisma.coursePurchase.update({
      where: { id: purchaseId },
      data: { status: "REJECTED", approvedById: actorId, approvedAt: new Date() },
    });
    return { success: true as const };
  }

  static async hasPurchased(courseId: string, userId: string) {
    const p = await prisma.coursePurchase.findUnique({
      where: { courseId_userId: { courseId, userId } },
    });
    return p?.status === "PAID";
  }
}
