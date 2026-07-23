import { prisma } from "@/lib/prisma";
import { PUBLIC_LESSON_WHERE, PUBLIC_SHORT_VIDEO_WHERE } from "@/lib/video-visibility";
import { getDownloadUrl, resolvePublicMediaUrl } from "@/lib/r2";
import { withCache, CacheTTL } from "@/lib/prisma-cache";
import { LoggingService } from "@/services/logging.service";
import { NotificationService } from "@/services/notification.service";
import { Prisma, type CourseStatus, type TeacherLevel } from "@prisma/client";

/** Minimum student ratings before the level changes automatically. */
const MIN_RATINGS_FOR_AUTO_LEVEL = 5;

/** Each store course must have at least this many quizzes before going live. */
export const MIN_COURSE_QUIZZES = 2;
/** Required free preview lessons (including the interview) — one approval path. */
export const MIN_FREE_PREVIEW_VIDEOS = 2;
/** Alternate approval path: at least this many free preview seconds on a lesson. */
export const MIN_TIMED_FREE_PREVIEW_SEC = 120; // 2 minutes
/** Required course documents (PDF / materials). */
export const MIN_COURSE_DOCUMENTS = 1;

export type CourseReadiness = {
  hasTitle: boolean;
  hasCover: boolean;
  freeVideos: number;
  hasInterview: boolean;
  /** Max freePreviewSec among non-full-free lessons. */
  timedFreeSec: number;
  hasTimedFree: boolean;
  /** True if 2 full free videos OR ≥2 free minutes (or both). */
  hasSampleAccess: boolean;
  quizzes: number;
  documents: number;
  ready: boolean;
  missing: string[];
};

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
      accessMonths?: number;
    }
  ) {
    const teacher = await prisma.teacherProfile.findFirst({
      where: { id: teacherId, deletedAt: null },
      include: {
        subjects: {
          include: {
            subject: { select: { id: true, stageId: true } },
          },
        },
      },
    });
    if (!teacher) return { success: false as const, error: "TEACHER_NOT_FOUND" };
    if (!teacher.isActive) return { success: false as const, error: "TEACHER_BLOCKED" };
    if (teacher.subjects.length === 0) {
      return { success: false as const, error: "NO_SPECIALTIES_SET" };
    }

    // Courses must match the teacher's assigned subjects / insights.
    const allowed = teacher.subjects.some((s) => s.subjectId === input.subjectId);
    if (!allowed) return { success: false as const, error: "SUBJECT_NOT_ASSIGNED" };

    const stage = await prisma.educationalStage.findFirst({
      where: { id: input.stageId, deletedAt: null, isActive: true },
      select: { id: true, isCertificateTrack: true },
    });
    if (!stage) return { success: false as const, error: "STAGE_NOT_FOUND" };

    if (teacher.teachingTrack === "CERTIFICATE") {
      if (!stage.isCertificateTrack) {
        return { success: false as const, error: "STAGE_TRACK_MISMATCH" };
      }
      // Insight subjects belong to the cert stage — enforce that pairing.
      const insight = teacher.subjects.find((s) => s.subjectId === input.subjectId);
      if (insight?.subject.stageId && insight.subject.stageId !== input.stageId) {
        return { success: false as const, error: "SUBJECT_STAGE_MISMATCH" };
      }
    } else if (stage.isCertificateTrack) {
      return { success: false as const, error: "STAGE_TRACK_MISMATCH" };
    }

    if (!(input.price >= 0)) return { success: false as const, error: "INVALID_PRICE" };

    const months =
      input.accessMonths != null && input.accessMonths > 0
        ? Math.min(120, Math.floor(input.accessMonths))
        : 10;

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
        accessMonths: months,
        status: "DRAFT",
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

  /** Admin can edit any course; subject/track rules are not enforced. */
  static async updateCourseAsAdmin(
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
      accessMonths: number;
      appleProductId: string | null;
      googleProductId: string | null;
    }>
  ) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" };

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: input,
    });
    return { success: true as const, course: updated };
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
      accessMonths: number;
      appleProductId: string | null;
      googleProductId: string | null;
    }>
  ) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, teacherId, deletedAt: null },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" };

    if (input.subjectId || input.stageId) {
      const teacher = await prisma.teacherProfile.findFirst({
        where: { id: teacherId, deletedAt: null },
        include: {
          subjects: {
            include: { subject: { select: { id: true, stageId: true } } },
          },
        },
      });
      if (!teacher) return { success: false as const, error: "TEACHER_NOT_FOUND" };
      const nextSubjectId = input.subjectId ?? course.subjectId;
      const nextStageId = input.stageId ?? course.stageId;
      const allowed = teacher.subjects.some((s) => s.subjectId === nextSubjectId);
      if (!allowed) return { success: false as const, error: "SUBJECT_NOT_ASSIGNED" };

      const stage = await prisma.educationalStage.findFirst({
        where: { id: nextStageId, deletedAt: null },
        select: { isCertificateTrack: true },
      });
      if (!stage) return { success: false as const, error: "STAGE_NOT_FOUND" };
      if (teacher.teachingTrack === "CERTIFICATE") {
        if (!stage.isCertificateTrack) {
          return { success: false as const, error: "STAGE_TRACK_MISMATCH" };
        }
        const insight = teacher.subjects.find((s) => s.subjectId === nextSubjectId);
        if (insight?.subject.stageId && insight.subject.stageId !== nextStageId) {
          return { success: false as const, error: "SUBJECT_STAGE_MISMATCH" };
        }
      } else if (stage.isCertificateTrack) {
        return { success: false as const, error: "STAGE_TRACK_MISMATCH" };
      }
    }

    // Cosmetic-only edits (cover, titles, description) stay live on APPROVED courses.
    // Price / stage / subject changes that actually differ re-enter review.
    const priceChanged =
      input.price !== undefined && Number(input.price) !== Number(course.price);
    const structuralChanged =
      priceChanged ||
      (input.stageId !== undefined && input.stageId !== course.stageId) ||
      (input.subjectId !== undefined && input.subjectId !== course.subjectId);

    const nextStatus =
      course.status === "DRAFT"
        ? "DRAFT"
        : course.status === "APPROVED"
          ? structuralChanged
            ? "PENDING_REVIEW"
            : "APPROVED"
          : course.status === "REJECTED"
            ? "REJECTED"
            : course.status;

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        ...input,
        status: nextStatus,
        ...(nextStatus === "PENDING_REVIEW"
          ? { reviewedAt: null, reviewNotes: null }
          : {}),
      },
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

  static async deleteCourseAsAdmin(courseId: string) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" };

    await prisma.course.update({
      where: { id: courseId },
      data: { deletedAt: new Date() },
    });
    return { success: true as const };
  }

  static async listTeacherCourses(teacherId: string) {
    const courses = await prisma.course.findMany({
      where: { teacherId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        stage: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
        subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
        lessons: {
          where: { deletedAt: null },
          orderBy: { sortOrder: "asc" },
          include: {
            materials: {
              where: { deletedAt: null },
              select: {
                id: true,
                title: true,
                type: true,
                fileKey: true,
                fileUrl: true,
                mimeType: true,
                fileSize: true,
                lessonId: true,
              },
            },
          },
        },
        quizzes: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            titleEn: true,
            titleAr: true,
            afterLessonId: true,
            _count: { select: { questions: true } },
          },
        },
        _count: {
          select: {
            purchases: { where: { status: "PAID" } },
            quizzes: { where: { deletedAt: null } },
          },
        },
      },
    });

    return courses.map((c) => this.formatTeacherCourse(c));
  }

  /** Teachers may edit anytime but only preview media after admin approval. */
  static formatTeacherCourse<
    T extends {
      status: CourseStatus;
      lessons: Array<{
        fileKey: string | null;
        fileUrl: string | null;
        materials?: Array<{
          fileKey: string | null;
          fileUrl: string | null;
          [key: string]: unknown;
        }>;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    },
  >(course: T) {
    // Teachers always see their own media (draft wizard + manage).
    const canPreview = true;
    return {
      ...course,
      canPreview,
      lessons: course.lessons.map((lesson) => ({
        ...lesson,
        canWatch: canPreview,
        fileKey: canPreview ? lesson.fileKey : null,
        fileUrl: canPreview ? lesson.fileUrl : null,
        materials: (lesson.materials ?? []).map((m) => ({
          ...m,
          canDownload: canPreview,
          fileKey: canPreview ? m.fileKey : null,
          fileUrl: canPreview ? m.fileUrl : null,
        })),
      })),
    };
  }

  /**
   * If the course has free previews but none marked as interview,
   * promote the first free preview (by sort order) to interview.
   * Interview always counts as one of the required free videos.
   */
  static async ensureInterviewFromFreePreviews(courseId: string) {
    const lessons = await prisma.courseLesson.findMany({
      where: { courseId, deletedAt: null },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        isFreePreview: true,
        isInterview: true,
        lessonType: true,
        fileKey: true,
        fileUrl: true,
        videoAssetId: true,
        sortOrder: true,
      },
    });

    const videoLessons = lessons.filter(
      (l) =>
        l.lessonType === "VIDEO" && (l.fileKey || l.fileUrl || l.videoAssetId)
    );
    if (videoLessons.some((l) => l.isInterview && l.isFreePreview)) {
      return { promoted: false as const };
    }

    const candidate = videoLessons.find((l) => l.isFreePreview) ?? null;
    if (!candidate) {
      return { promoted: false as const };
    }

    await prisma.$transaction([
      prisma.courseLesson.updateMany({
        where: { courseId, isInterview: true, deletedAt: null, id: { not: candidate.id } },
        data: { isInterview: false },
      }),
      prisma.courseLesson.update({
        where: { id: candidate.id },
        data: {
          isInterview: true,
          isFreePreview: true,
          sortOrder: 0,
        },
      }),
      // Keep other lessons after the interview without colliding on sortOrder 0.
      ...videoLessons
        .filter((l) => l.id !== candidate.id)
        .map((l, index) =>
          prisma.courseLesson.update({
            where: { id: l.id },
            data: { sortOrder: index + 1 },
          })
        ),
    ]);

    return { promoted: true as const, lessonId: candidate.id };
  }

  static async getCourseReadiness(courseId: string): Promise<CourseReadiness> {
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: {
        titleEn: true,
        thumbnail: true,
        lessons: {
          where: { deletedAt: null },
          select: {
            isFreePreview: true,
            isInterview: true,
            freePreviewSec: true,
            lessonType: true,
            fileKey: true,
            fileUrl: true,
            videoAssetId: true,
            whiteboardAssetId: true,
            whiteboardAsset: { select: { processingStatus: true } },
          },
        },
        materials: {
          where: { deletedAt: null },
          select: { id: true },
        },
      },
    });

    if (!course) {
      return {
        hasTitle: false,
        hasCover: false,
        freeVideos: 0,
        hasInterview: false,
        timedFreeSec: 0,
        hasTimedFree: false,
        hasSampleAccess: false,
        quizzes: 0,
        documents: 0,
        ready: false,
        missing: ["Course not found"],
      };
    }

    const videoLessons = course.lessons.filter(
      (l) =>
        l.lessonType === "VIDEO" && (l.fileKey || l.fileUrl || l.videoAssetId)
    );
    const freeVideos = videoLessons.filter((l) => l.isFreePreview).length;
    const hasInterview = videoLessons.some((l) => l.isInterview && l.isFreePreview);
    const timedFreeSec = videoLessons.reduce((max, l) => {
      if (l.isFreePreview) return max;
      const sec = typeof l.freePreviewSec === "number" ? l.freePreviewSec : 0;
      return Math.max(max, sec);
    }, 0);
    const hasTimedFree = timedFreeSec >= MIN_TIMED_FREE_PREVIEW_SEC;
    const hasEnoughFullFree = freeVideos >= MIN_FREE_PREVIEW_VIDEOS;
    // Approve with 2 full free videos, OR ≥2 free minutes on a lesson, OR both.
    const hasSampleAccess = hasEnoughFullFree || hasTimedFree;
    const quizzes = await this.countValidCourseQuizzes(courseId);
    const documents = course.materials.length;
    const hasTitle = Boolean(course.titleEn?.trim() && course.titleEn.trim().length >= 2);
    const hasCover = Boolean(course.thumbnail?.trim());

    const missing: string[] = [];
    if (!hasTitle) missing.push("Course title");
    if (!hasCover) missing.push("Course cover image");
    if (!hasSampleAccess) {
      missing.push(
        `Add ${MIN_FREE_PREVIEW_VIDEOS} free preview videos, or at least ${MIN_TIMED_FREE_PREVIEW_SEC / 60} free minutes on a lesson (or both)`
      );
    }
    if (quizzes < MIN_COURSE_QUIZZES) {
      missing.push(`At least ${MIN_COURSE_QUIZZES} quizzes with questions`);
    }
    if (documents < MIN_COURSE_DOCUMENTS) {
      missing.push("At least one course document (PDF)");
    }

    return {
      hasTitle,
      hasCover,
      freeVideos,
      hasInterview,
      timedFreeSec,
      hasTimedFree,
      hasSampleAccess,
      quizzes,
      documents,
      ready: missing.length === 0,
      missing,
    };
  }

  static async submitForReview(courseId: string, teacherId: string) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, teacherId, deletedAt: null },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" as const };
    if (!["DRAFT", "REJECTED"].includes(course.status)) {
      return { success: false as const, error: "INVALID_STATUS" as const };
    }

    await this.ensureInterviewFromFreePreviews(courseId);
    const readiness = await this.getCourseReadiness(courseId);
    if (!readiness.ready) {
      return { success: false as const, error: "NOT_READY" as const, readiness };
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        status: "PENDING_REVIEW",
        reviewNotes: null,
        reviewedAt: null,
        reviewedById: null,
      },
    });

    return { success: true as const, course: updated, readiness };
  }

  /** Reorder lessons; interview lesson is forced to sortOrder 0. */
  static async reorderLessons(courseId: string, teacherId: string, lessonIds: string[]) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, teacherId, deletedAt: null },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" as const };
    return this.reorderLessonsAndReview(courseId, course.status, lessonIds);
  }

  /** Admin can reorder lessons for any non-deleted course. */
  static async reorderLessonsAsAdmin(courseId: string, lessonIds: string[]) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { status: true },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" as const };
    return this.reorderLessonsForCourse(courseId, course.status, lessonIds);
  }

  private static async reorderLessonsForCourse(
    courseId: string,
    courseStatus: CourseStatus,
    lessonIds: string[]
  ) {
    const lessons = await prisma.courseLesson.findMany({
      where: { courseId, deletedAt: null, id: { in: lessonIds } },
      select: { id: true, isInterview: true },
    });
    if (lessons.length !== lessonIds.length) {
      return { success: false as const, error: "INVALID_LESSONS" as const };
    }

    const interview = lessons.find((l) => l.isInterview);
    let ordered = [...lessonIds];
    if (interview) {
      ordered = [interview.id, ...ordered.filter((id) => id !== interview.id)];
    }

    await prisma.$transaction(
      ordered.map((id, index) =>
        prisma.courseLesson.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    return { success: true as const, lessonIds: ordered };
  }

  /** Reorder lessons on an approved course and send back for teacher review. */
  static async reorderLessonsAndReview(
    courseId: string,
    courseStatus: CourseStatus,
    lessonIds: string[]
  ) {
    const result = await this.reorderLessonsForCourse(courseId, courseStatus, lessonIds);
    if (result.success && courseStatus === "APPROVED") {
      await this.markCoursePendingReview(courseId);
    }
    return result;
  }

  static async markCoursePendingReview(courseId: string) {
    const summary = await this.computePendingChangeSummary(courseId);
    await prisma.course.updateMany({
      where: { id: courseId, status: "APPROVED", deletedAt: null },
      data: {
        status: "PENDING_REVIEW",
        reviewedAt: null,
        reviewNotes: null,
        reviewedById: null,
        pendingChangeSummary: summary ?? undefined,
      },
    });
  }

  /** Build a structural snapshot used for admin change diffs. */
  static async buildApprovedSnapshot(courseId: string) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: {
        titleEn: true,
        price: true,
        stageId: true,
        subjectId: true,
        thumbnail: true,
        lessons: {
          where: { deletedAt: null },
          select: {
            id: true,
            title: true,
            fileUrl: true,
            durationSec: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: "asc" },
        },
        quizzes: {
          where: { deletedAt: null },
          select: { id: true, titleEn: true },
        },
        materials: {
          where: { deletedAt: null },
          select: { id: true, title: true, type: true },
        },
      },
    });
    if (!course) return null;
    return {
      titleEn: course.titleEn,
      price: course.price,
      stageId: course.stageId,
      subjectId: course.subjectId,
      thumbnail: course.thumbnail,
      lessonIds: course.lessons.map((l) => l.id),
      lessonMeta: Object.fromEntries(
        course.lessons.map((l) => [
          l.id,
          {
            title: l.title,
            fileUrl: l.fileUrl,
            durationSec: l.durationSec,
            sortOrder: l.sortOrder,
          },
        ])
      ),
      quizIds: course.quizzes.map((q) => q.id),
      quizMeta: Object.fromEntries(
        course.quizzes.map((q) => [q.id, { titleEn: q.titleEn }])
      ),
      materialIds: course.materials.map((m) => m.id),
      materialMeta: Object.fromEntries(
        course.materials.map((m) => [m.id, { title: m.title, type: m.type }])
      ),
    };
  }

  static async computePendingChangeSummary(courseId: string) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { lastApprovedSnapshot: true },
    });
    const snap = course?.lastApprovedSnapshot as {
      titleEn?: string;
      price?: number;
      stageId?: string;
      subjectId?: string;
      thumbnail?: string | null;
      lessonIds?: string[];
      lessonMeta?: Record<string, { title?: string; fileUrl?: string | null }>;
      quizIds?: string[];
      quizMeta?: Record<string, { titleEn?: string }>;
      materialIds?: string[];
      materialMeta?: Record<string, { title?: string }>;
    } | null;

    if (!snap) {
      return {
        firstReview: true,
        note: "No prior approved snapshot — full course is new or never snapshotted.",
      };
    }

    const current = await this.buildApprovedSnapshot(courseId);
    if (!current) return null;

    const prevLessons = new Set(snap.lessonIds ?? []);
    const nextLessons = new Set(current.lessonIds);
    const addedLessons = current.lessonIds
      .filter((id) => !prevLessons.has(id))
      .map((id) => ({
        id,
        title: current.lessonMeta[id]?.title,
      }));
    const removedLessons = (snap.lessonIds ?? [])
      .filter((id) => !nextLessons.has(id))
      .map((id) => ({
        id,
        title: snap.lessonMeta?.[id]?.title,
      }));
    const changedLessons = current.lessonIds
      .filter((id) => prevLessons.has(id))
      .filter((id) => {
        const a = snap.lessonMeta?.[id];
        const b = current.lessonMeta[id];
        return a?.title !== b?.title || a?.fileUrl !== b?.fileUrl;
      })
      .map((id) => ({
        id,
        previousTitle: snap.lessonMeta?.[id]?.title,
        title: current.lessonMeta[id]?.title,
        videoChanged:
          snap.lessonMeta?.[id]?.fileUrl !== current.lessonMeta[id]?.fileUrl,
      }));

    const prevQuizzes = new Set(snap.quizIds ?? []);
    const nextQuizzes = new Set(current.quizIds);
    const addedQuizzes = current.quizIds
      .filter((id) => !prevQuizzes.has(id))
      .map((id) => ({ id, titleEn: current.quizMeta[id]?.titleEn }));
    const removedQuizzes = (snap.quizIds ?? [])
      .filter((id) => !nextQuizzes.has(id))
      .map((id) => ({ id, titleEn: snap.quizMeta?.[id]?.titleEn }));

    const prevMats = new Set(snap.materialIds ?? []);
    const nextMats = new Set(current.materialIds);
    const addedMaterials = current.materialIds
      .filter((id) => !prevMats.has(id))
      .map((id) => ({ id, title: current.materialMeta[id]?.title }));
    const removedMaterials = (snap.materialIds ?? [])
      .filter((id) => !nextMats.has(id))
      .map((id) => ({ id, title: snap.materialMeta?.[id]?.title }));

    return {
      firstReview: false,
      titleChanged: snap.titleEn !== current.titleEn,
      previousTitle: snap.titleEn,
      titleEn: current.titleEn,
      priceChanged: snap.price !== current.price,
      previousPrice: snap.price,
      price: current.price,
      stageChanged: snap.stageId !== current.stageId,
      subjectChanged: snap.subjectId !== current.subjectId,
      thumbnailChanged: snap.thumbnail !== current.thumbnail,
      addedLessons,
      removedLessons,
      changedLessons,
      addedQuizzes,
      removedQuizzes,
      addedMaterials,
      removedMaterials,
    };
  }

  static async attachLessonPdf(
    courseId: string,
    lessonId: string,
    pdf: {
      title: string;
      fileKey?: string;
      fileUrl?: string;
      mimeType?: string;
      fileSize?: number;
    }
  ) {
    const existing = await prisma.courseMaterial.findFirst({
      where: { courseId, lessonId, deletedAt: null, type: "PDF" },
    });
    if (existing) {
      const updated = await prisma.courseMaterial.update({
        where: { id: existing.id },
        data: {
          title: pdf.title,
          fileKey: pdf.fileKey ?? null,
          fileUrl: pdf.fileUrl ?? null,
          mimeType: pdf.mimeType ?? "application/pdf",
          fileSize: pdf.fileSize ?? null,
        },
      });
      const { enqueueCourseMaterialIngest } = await import("@/services/ai/ingest-hooks");
      enqueueCourseMaterialIngest(updated);
      return updated;
    }
    const created = await prisma.courseMaterial.create({
      data: {
        courseId,
        lessonId,
        title: pdf.title,
        type: "PDF",
        fileKey: pdf.fileKey ?? null,
        fileUrl: pdf.fileUrl ?? null,
        mimeType: pdf.mimeType ?? "application/pdf",
        fileSize: pdf.fileSize ?? null,
      },
    });
    const { enqueueCourseMaterialIngest } = await import("@/services/ai/ingest-hooks");
    enqueueCourseMaterialIngest(created);
    return created;
  }

  static async countValidCourseQuizzes(courseId: string) {
    return prisma.quiz.count({
      where: {
        courseId,
        deletedAt: null,
        questions: { some: { deletedAt: null } },
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
    notes?: string,
    options?: {
      accessMonths?: number;
      appleProductId?: string | null;
      googleProductId?: string | null;
    }
  ) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      include: {
        teacher: {
          include: { user: { select: { id: true, fullLegalName: true } } },
        },
      },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" };

    const previousSnapshot = course.lastApprovedSnapshot;
    const pendingSummary = course.pendingChangeSummary as {
      firstReview?: boolean;
      addedLessons?: { id: string; title?: string }[];
      changedLessons?: { id: string; title?: string; videoChanged?: boolean }[];
    } | null;

    // A blocked teacher or a "needs improvement" level cannot go live.
    let status: CourseStatus = decision;
    let closedByLevel = false;
    if (decision === "APPROVED") {
      if (!course.teacher.isActive) {
        return { success: false as const, error: "TEACHER_BLOCKED" };
      }
      await this.ensureInterviewFromFreePreviews(courseId);
      const readiness = await this.getCourseReadiness(courseId);
      if (!readiness.ready) {
        return {
          success: false as const,
          error: "NOT_READY" as const,
          readiness,
        };
      }
      if (course.teacher.level === "NEEDS_IMPROVEMENT") {
        status = "CLOSED";
        closedByLevel = true;
      }
    }

    const accessMonths =
      options?.accessMonths != null && options.accessMonths > 0
        ? Math.min(120, Math.floor(options.accessMonths))
        : undefined;
    const appleProductId =
      options?.appleProductId !== undefined
        ? options.appleProductId?.trim() || null
        : undefined;
    const googleProductId =
      options?.googleProductId !== undefined
        ? options.googleProductId?.trim() || null
        : undefined;

    const snapshot =
      decision === "APPROVED" && status === "APPROVED"
        ? await this.buildApprovedSnapshot(courseId)
        : null;

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        status,
        closedByLevel,
        reviewNotes: notes || null,
        reviewedById: actorId,
        reviewedAt: new Date(),
        ...(accessMonths !== undefined ? { accessMonths } : {}),
        ...(appleProductId !== undefined ? { appleProductId } : {}),
        ...(googleProductId !== undefined ? { googleProductId } : {}),
        ...(snapshot
          ? {
              lastApprovedSnapshot: snapshot,
              pendingChangeSummary: Prisma.DbNull,
            }
          : decision === "REJECTED"
            ? { pendingChangeSummary: Prisma.DbNull }
            : {}),
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

    if (decision === "APPROVED" && status === "APPROVED") {
      void this.notifySubscribersAfterApproval({
        courseId,
        courseTitle: course.titleEn,
        teacherId: course.teacherId,
        teacherUserId: course.teacher.userId,
        teacherName: course.teacher.user.fullLegalName || "Your teacher",
        previousSnapshot,
        pendingSummary,
      }).catch(() => {});
    }

    return { success: true as const, course: updated };
  }

  /** Notify students when a course goes live or gains new lessons after admin approval. */
  private static async notifySubscribersAfterApproval(params: {
    courseId: string;
    courseTitle: string;
    teacherId: string;
    teacherUserId: string;
    teacherName: string;
    previousSnapshot: unknown;
    pendingSummary: {
      firstReview?: boolean;
      addedLessons?: { id: string; title?: string }[];
      changedLessons?: { id: string; title?: string; videoChanged?: boolean }[];
    } | null;
  }) {
    const {
      notifySubscribersNewCourse,
      notifySubscribersNewLesson,
      notifySubscribersLessonUpdated,
    } = await import("@/services/engagement-notifications.service");

    const isFirstPublish = !params.previousSnapshot;

    if (isFirstPublish) {
      const fanIds = await this.paidSubscriberUserIdsForTeacher(params.teacherId, {
        excludeCourseId: params.courseId,
        excludeUserId: params.teacherUserId,
      });
      if (fanIds.length === 0) return;
      await notifySubscribersNewCourse({
        userIds: fanIds,
        courseTitle: params.courseTitle,
        courseId: params.courseId,
        teacherName: params.teacherName,
      });
      return;
    }

    const addedFromPending = params.pendingSummary?.addedLessons ?? [];
    let added = addedFromPending;
    if (added.length === 0 && params.previousSnapshot) {
      const snap = params.previousSnapshot as { lessonIds?: string[] };
      const current = await this.buildApprovedSnapshot(params.courseId);
      if (current) {
        const prev = new Set(snap.lessonIds ?? []);
        added = current.lessonIds
          .filter((id) => !prev.has(id))
          .map((id) => ({
            id,
            title: current.lessonMeta[id]?.title,
          }));
      }
    }

    const courseBuyerIds = await this.paidSubscriberUserIdsForCourse(params.courseId, {
      excludeUserId: params.teacherUserId,
    });
    if (courseBuyerIds.length === 0) return;

    if (added.length > 0) {
      const primary = added[0]!;
      await notifySubscribersNewLesson({
        userIds: courseBuyerIds,
        courseTitle: params.courseTitle,
        lessonTitle: primary.title || "New lesson",
        courseId: params.courseId,
        lessonId: primary.id,
        extraCount: Math.max(0, added.length - 1),
      });
      return;
    }

    const changed =
      params.pendingSummary?.changedLessons?.filter((l) => l.videoChanged) ?? [];
    if (changed.length > 0) {
      const primary = changed[0]!;
      await notifySubscribersLessonUpdated({
        userIds: courseBuyerIds,
        courseTitle: params.courseTitle,
        lessonTitle: primary.title || "Lesson",
        courseId: params.courseId,
        lessonId: primary.id,
      });
    }
  }

  static async paidSubscriberUserIdsForCourse(
    courseId: string,
    options?: { excludeUserId?: string }
  ): Promise<string[]> {
    const rows = await prisma.coursePurchase.findMany({
      where: { courseId, status: "PAID" },
      select: { userId: true },
      distinct: ["userId"],
    });
    const ids = rows.map((r) => r.userId);
    if (!options?.excludeUserId) return ids;
    return ids.filter((id) => id !== options.excludeUserId);
  }

  static async paidSubscriberUserIdsForTeacher(
    teacherId: string,
    options?: { excludeCourseId?: string; excludeUserId?: string }
  ): Promise<string[]> {
    const rows = await prisma.coursePurchase.findMany({
      where: {
        status: "PAID",
        course: {
          teacherId,
          deletedAt: null,
          ...(options?.excludeCourseId
            ? { id: { not: options.excludeCourseId } }
            : {}),
        },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    const ids = rows.map((r) => r.userId);
    if (!options?.excludeUserId) return ids;
    return ids.filter((id) => id !== options.excludeUserId);
  }

  // ── Student browse & purchase ───────────────────────────────

  /** Courses visible to students: approved, active teacher, level >= GOOD. */
  static async listPublishedCourses(filter?: {
    stageId?: string;
    subjectId?: string;
    subjectIds?: string[];
    teacherId?: string;
    q?: string;
    levels?: TeacherLevel[];
  }) {
    const q = filter?.q?.trim();
    const args = {
      where: {
        status: "APPROVED" as const,
        deletedAt: null,
        ...(filter?.stageId ? { stageId: filter.stageId } : {}),
        ...(filter?.subjectId ? { subjectId: filter.subjectId } : {}),
        ...(filter?.subjectIds?.length
          ? { subjectId: { in: filter.subjectIds } }
          : {}),
        ...(filter?.teacherId ? { teacherId: filter.teacherId } : {}),
        // Free-text search across course titles, teacher names and video titles.
        ...(q
          ? {
              OR: [
                { titleEn: { contains: q, mode: "insensitive" as const } },
                { titleAr: { contains: q, mode: "insensitive" as const } },
                { titleKu: { contains: q, mode: "insensitive" as const } },
                { titleTr: { contains: q, mode: "insensitive" as const } },
                { description: { contains: q, mode: "insensitive" as const } },
                {
                  teacher: {
                    user: {
                      fullLegalName: { contains: q, mode: "insensitive" as const },
                    },
                  },
                },
                {
                  lessons: {
                    some: { title: { contains: q, mode: "insensitive" as const } },
                  },
                },
              ],
            }
          : {}),
        teacher: {
          isActive: true,
          deletedAt: null,
          level: filter?.levels?.length
            ? { in: filter.levels.filter((l) => l !== "NEEDS_IMPROVEMENT") }
            : { not: "NEEDS_IMPROVEMENT" as const },
          user: { status: "APPROVED" as const, deletedAt: null },
        },
      },
      orderBy: { createdAt: "desc" as const },
      include: {
        teacher: {
          select: {
            id: true,
            level: true,
            userId: true,
            user: {
              select: {
                fullLegalName: true,
                profilePhotoUrl: true,
                profilePhotoKey: true,
              },
            },
          },
        },
        stage: {
          select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true },
        },
        subject: {
          select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true },
        },
        lessons: {
          where: PUBLIC_LESSON_WHERE,
          orderBy: { sortOrder: "asc" as const },
          select: {
            id: true,
            title: true,
            durationSec: true,
            isFreePreview: true,
            thumbnailUrl: true,
            thumbnailKey: true,
            sortOrder: true,
          },
        },
        _count: { select: { purchases: { where: { status: "PAID" as const } } } },
      },
    };

    // Skip Accelerate cache when searching — results are unique per query.
    return prisma.course.findMany(q ? args : withCache(args, CacheTTL.catalog));
  }

  /** Public teacher profile with live store courses for students. */
  static async getTeacherStoreProfile(teacherId: string, userId?: string) {
    const teacher = await prisma.teacherProfile.findFirst({
      where: {
        id: teacherId,
        deletedAt: null,
        isActive: true,
        level: { not: "NEEDS_IMPROVEMENT" },
        user: { status: "APPROVED", deletedAt: null },
      },
      include: {
        user: {
          select: {
            fullLegalName: true,
            profilePhotoUrl: true,
            profilePhotoKey: true,
            profileCoverPreset: true,
          },
        },
        subjects: {
          include: {
            subject: {
              select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true },
            },
          },
        },
        _count: {
          select: {
            courses: { where: { status: "APPROVED", deletedAt: null } },
            shortVideos: { where: PUBLIC_SHORT_VIDEO_WHERE },
          },
        },
      },
    });
    if (!teacher) return { success: false as const, error: "NOT_FOUND" as const };

    const courses = await this.listPublishedCourses({ teacherId });
    const enriched = await this.enrichCoursesForUser(courses, userId);

    const ratingAgg = await prisma.teacherRating.aggregate({
      where: { teacherId },
      _avg: { rating: true },
      _count: true,
    });

    const { ShortVideoService } = await import("@/services/short-video.service");
    const shortVideos = await ShortVideoService.listForTeacher(teacherId, userId);

    const courseIds = courses.map((c) => c.id);
    const [subscriptionsCount, courseLikes, lessonLikes, shortLikes] = await Promise.all([
      courseIds.length
        ? prisma.coursePurchase.count({
            where: { courseId: { in: courseIds }, status: "PAID" },
          })
        : Promise.resolve(0),
      courseIds.length
        ? prisma.courseReaction.count({
            where: { courseId: { in: courseIds }, type: "LIKE" },
          })
        : Promise.resolve(0),
      courseIds.length
        ? prisma.courseLessonLike.count({
            where: { lesson: { courseId: { in: courseIds } } },
          })
        : Promise.resolve(0),
      prisma.shortVideoLike.count({
        where: {
          video: { teacherId, deletedAt: null, status: "APPROVED" },
        },
      }),
    ]);

    return {
      success: true as const,
      teacher: {
        id: teacher.id,
        userId: teacher.userId,
        name: teacher.user.fullLegalName,
        profilePhotoUrl:
          (await resolvePublicMediaUrl(
            teacher.user.profilePhotoUrl,
            teacher.user.profilePhotoKey
          ).catch(() => null)) ?? teacher.user.profilePhotoUrl,
        profilePhotoKey: teacher.user.profilePhotoKey,
        profileCoverPreset: teacher.user.profileCoverPreset,
        bio: teacher.bio,
        level: teacher.level,
        specializations: teacher.specializations,
        subjects: teacher.subjects.map((s) => s.subject),
        liveCoursesCount: teacher._count.courses,
        reelsCount: teacher._count.shortVideos,
        subscriptionsCount,
        totalLikesCount: courseLikes + lessonLikes + shortLikes,
        courseLikesCount: courseLikes,
        lessonLikesCount: lessonLikes,
        shortVideoLikesCount: shortLikes,
        rating:
          ratingAgg._avg.rating != null
            ? Math.round(ratingAgg._avg.rating * 10) / 10
            : null,
        ratingCount: ratingAgg._count,
      },
      courses: enriched,
      shortVideos,
    };
  }

  /**
   * Adds per-user, per-course engagement data (reactions, favorites, teacher
   * rating, purchase status, duration totals) to a list of published courses.
   */
  static async enrichCoursesForUser(
    courses: Awaited<ReturnType<typeof TeacherCourseService.listPublishedCourses>>,
    userId?: string | null
  ) {
    const courseIds = courses.map((c) => c.id);
    const teacherIds = [...new Set(courses.map((c) => c.teacher.id))];
    const allLessonIds = courses.flatMap((c) => c.lessons.map((l) => l.id));

    const [
      reactionGroups,
      myReactions,
      favoriteGroups,
      myFavorites,
      ratingGroups,
      courseRatingGroups,
      purchases,
      durationGroups,
    ] = await Promise.all([
        prisma.courseReaction.groupBy({
          by: ["courseId", "type"],
          where: { courseId: { in: courseIds } },
          _count: true,
        }),
        userId
          ? prisma.courseReaction.findMany({
              where: { userId, courseId: { in: courseIds } },
              select: { courseId: true, type: true },
            })
          : Promise.resolve([] as { courseId: string; type: string }[]),
        prisma.courseFavorite.groupBy({
          by: ["courseId"],
          where: { courseId: { in: courseIds } },
          _count: true,
        }),
        userId
          ? prisma.courseFavorite.findMany({
              where: { userId, courseId: { in: courseIds } },
              select: { courseId: true },
            })
          : Promise.resolve([] as { courseId: string }[]),
        prisma.teacherRating.groupBy({
          by: ["teacherId"],
          where: { teacherId: { in: teacherIds } },
          _avg: { rating: true },
          _count: true,
        }),
        prisma.courseRating.groupBy({
          by: ["courseId"],
          where: { courseId: { in: courseIds } },
          _avg: { rating: true },
          _count: true,
        }),
        userId
          ? prisma.coursePurchase.findMany({
              where: { userId, courseId: { in: courseIds } },
              select: { courseId: true, status: true },
            })
          : Promise.resolve([] as { courseId: string; status: string }[]),
        allLessonIds.length
          ? prisma.courseLessonProgress.groupBy({
              by: ["lessonId"],
              where: { lessonId: { in: allLessonIds }, durationSec: { gt: 0 } },
              _max: { durationSec: true },
            })
          : Promise.resolve([]),
      ]);

    const reactions = new Map<string, { likes: number; dislikes: number }>();
    for (const g of reactionGroups) {
      const entry = reactions.get(g.courseId) ?? { likes: 0, dislikes: 0 };
      if (g.type === "LIKE") entry.likes = g._count;
      else entry.dislikes = g._count;
      reactions.set(g.courseId, entry);
    }
    const mine = new Map(myReactions.map((r) => [r.courseId, r.type]));
    const favorites = new Map(favoriteGroups.map((f) => [f.courseId, f._count]));
    const myFavs = new Set(myFavorites.map((f) => f.courseId));
    const ratings = new Map(
      ratingGroups.map((r) => [r.teacherId, { avg: r._avg.rating ?? 0, count: r._count }])
    );
    const courseRatings = new Map(
      courseRatingGroups.map((r) => [
        r.courseId,
        {
          avg: r._avg.rating != null ? Math.round(r._avg.rating * 10) / 10 : 0,
          count: r._count,
        },
      ])
    );
    const purchaseByCourse = new Map(purchases.map((p) => [p.courseId, p.status]));
    const watchedDuration = new Map(
      durationGroups.map((g) => [g.lessonId, g._max.durationSec ?? 0])
    );

    const thumbKeyCache = new Map<string, string>();
    async function resolveThumbUrl(
      url: string | null | undefined,
      key: string | null | undefined
    ) {
      const resolved = await resolvePublicMediaUrl(url, key).catch(() => null);
      if (resolved) return resolved;
      if (!key) return url?.trim() || null;
      const cached = thumbKeyCache.get(key);
      if (cached) return cached;
      const signed = await getDownloadUrl(key).catch(() => null);
      if (signed) thumbKeyCache.set(key, signed);
      return signed;
    }

    return Promise.all(
      courses.map(async (c) => {
        const r = reactions.get(c.id) ?? { likes: 0, dislikes: 0 };
        const rating = ratings.get(c.teacher.id) ?? { avg: 0, count: 0 };
        const courseRating = courseRatings.get(c.id) ?? { avg: 0, count: 0 };
        const lessons = c.lessons.map((l) => ({
          ...l,
          durationSec: l.durationSec ?? watchedDuration.get(l.id) ?? null,
        }));
        const totalDurationSec = lessons.reduce((s, l) => s + (l.durationSec ?? 0), 0);

        const firstLesson = lessons[0];
        let thumbnail = await resolveThumbUrl(c.thumbnail, null);
        if (!thumbnail && firstLesson) {
          thumbnail = await resolveThumbUrl(firstLesson.thumbnailUrl, firstLesson.thumbnailKey);
        }

        return {
          ...c,
          teacher: {
            ...c.teacher,
            user: {
              ...c.teacher.user,
              profilePhotoUrl:
                (await resolvePublicMediaUrl(
                  c.teacher.user.profilePhotoUrl,
                  (c.teacher.user as { profilePhotoKey?: string | null }).profilePhotoKey
                ).catch(() => null)) ?? c.teacher.user.profilePhotoUrl,
            },
          },
          lessons,
          thumbnail,
          updatedAt: c.updatedAt,
          likes: r.likes,
          dislikes: r.dislikes,
          myReaction: mine.get(c.id) ?? null,
          favorites: favorites.get(c.id) ?? 0,
          favoritedByMe: myFavs.has(c.id),
          teacherRating: Math.round(rating.avg * 10) / 10,
          teacherRatingCount: rating.count,
          courseRating: courseRating.avg > 0 ? courseRating.avg : null,
          courseRatingCount: courseRating.count,
          totalDurationSec,
          lessonsCount: lessons.length,
          freePreviewCount: lessons.filter((l) => l.isFreePreview).length,
          purchaseStatus: purchaseByCourse.get(c.id) ?? null,
          isOwnCourse: c.teacher.userId === userId,
          subscribersCount: c._count.purchases,
        };
      })
    );
  }

  static async requestPurchase(courseId: string, userId: string) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, status: "APPROVED", deletedAt: null },
      include: { teacher: { select: { userId: true } } },
    });
    if (!course) return { success: false as const, error: "COURSE_NOT_AVAILABLE" };
    if (course.teacher.userId === userId) {
      return { success: false as const, error: "OWN_COURSE" };
    }

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

    const months =
      purchase.course.accessMonths > 0 ? purchase.course.accessMonths : 10;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + months);

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
        expiresAt,
        source: "ADMIN",
      },
    });

    await LoggingService.log({
      actorId,
      action: "APPROVE_COURSE_PURCHASE",
      entityType: "CoursePurchase",
      entityId: purchaseId,
      newValue: { level, deductionPct, platformAmount, teacherAmount, expiresAt },
    });

    await NotificationService.notifyUser(
      purchase.userId,
      {
      titleEn: "Course Unlocked",
      titleAr: "تم فتح الدورة",
      titleKu: "کۆرسەکە کرایەوە",
      titleTr: "Kursun Kilidi Açıldı",
      bodyEn: `Your payment was confirmed. "${purchase.course.titleEn}" is now available.`,
      bodyAr: `تم تأكيد الدفع. "${purchase.course.titleEn}" متاحة الآن.`,
      bodyKu: `پارەدانەکەت پشتڕاست کرایەوە. "${purchase.course.titleEn}" ئێستا بەردەستە.`,
      bodyTr: `Ödemeniz onaylandı. "${purchase.course.titleEn}" artık kullanılabilir.`,
      },
      {
        type: "course",
        courseId: purchase.courseId,
        screen: "course",
      }
    ).catch(() => {});

    // Notify the teacher that a student subscribed / purchased this course.
    if (purchase.course.teacher.userId !== purchase.userId) {
      const { notifyTeacherNewSubscription } = await import(
        "@/services/engagement-notifications.service"
      );
      const student = await prisma.user.findUnique({
        where: { id: purchase.userId },
        select: { fullLegalName: true },
      });
      await notifyTeacherNewSubscription({
        teacherUserId: purchase.course.teacher.userId,
        studentName: student?.fullLegalName ?? "A student",
        courseTitle: purchase.course.titleEn,
        courseId: purchase.courseId,
      });
    }

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

  /** Admin cancels a paid course subscription — revokes access immediately. */
  static async cancelPurchase(purchaseId: string, actorId: string) {
    const purchase = await prisma.coursePurchase.findUnique({
      where: { id: purchaseId },
      include: {
        course: { select: { id: true, titleEn: true } },
        user: { select: { id: true } },
      },
    });
    if (!purchase || purchase.status !== "PAID") {
      return { success: false as const, error: "INVALID_PURCHASE" };
    }

    const updated = await prisma.coursePurchase.update({
      where: { id: purchaseId },
      data: {
        status: "REJECTED",
        approvedById: actorId,
        approvedAt: new Date(),
        expiresAt: new Date(),
      },
    });

    await LoggingService.log({
      actorId,
      action: "CANCEL_COURSE_PURCHASE",
      entityType: "CoursePurchase",
      entityId: purchaseId,
      previousValue: { status: "PAID", courseId: purchase.courseId },
      newValue: { status: "REJECTED", userId: purchase.userId },
    });

    await NotificationService.notifyUser(
      purchase.userId,
      {
        titleEn: "Course access cancelled",
        titleAr: "تم إلغاء الوصول للدورة",
        titleKu: "دەستگەیشتن بە کۆرس هەڵوەشایەوە",
        titleTr: "Kurs erişimi iptal edildi",
        bodyEn: `Your access to "${purchase.course.titleEn}" was cancelled by admin.`,
        bodyAr: `تم إلغاء وصولك إلى "${purchase.course.titleEn}" بواسطة المسؤول.`,
        bodyKu: `دەستگەیشتنت بۆ "${purchase.course.titleEn}" لەلایەن ئەدمینەوە هەڵوەشایەوە.`,
        bodyTr: `"${purchase.course.titleEn}" kursuna erişiminiz yönetici tarafından iptal edildi.`,
      },
      {
        type: "course",
        courseId: purchase.courseId,
        screen: "course",
      }
    ).catch(() => {});

    return { success: true as const, purchase: updated };
  }

  static async hasPurchased(courseId: string, userId: string) {
    const p = await prisma.coursePurchase.findUnique({
      where: { courseId_userId: { courseId, userId } },
    });
    if (!p || p.status !== "PAID") return false;
    if (p.expiresAt && p.expiresAt.getTime() <= Date.now()) return false;
    return true;
  }
}
