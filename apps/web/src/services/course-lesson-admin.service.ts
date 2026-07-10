import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";
import {
  buildTokenAndClauses,
  visibilityWhere,
  tokenizeSearch,
  type AdminVisibilityFilter,
} from "@/lib/video-visibility";
import { LoggingService } from "@/services/logging.service";
import { NotificationService } from "@/services/notification.service";
import type { CourseStatus, Prisma } from "@prisma/client";

async function resolveVideoUrl(fileKey: string | null, fileUrl: string | null) {
  if (fileUrl) return fileUrl;
  if (fileKey) return getDownloadUrl(fileKey).catch(() => null);
  return null;
}

export type CourseLessonAdminFilters = {
  q?: string;
  visibility?: AdminVisibilityFilter;
  courseStatus?: CourseStatus;
  sort?: "newest" | "oldest" | "title";
};

export class CourseLessonAdminService {
  static async list(filters: CourseLessonAdminFilters = {}) {
    const visibility = filters.visibility ?? "visible";
    const tokens = tokenizeSearch(filters.q ?? "");

    const searchClauses =
      tokens.length > 0
        ? buildTokenAndClauses<Prisma.CourseLessonWhereInput>(tokens, [
            (token) => ({ title: { contains: token, mode: "insensitive" } }),
            (token) => ({
              course: { titleEn: { contains: token, mode: "insensitive" } },
            }),
            (token) => ({
              course: { titleAr: { contains: token, mode: "insensitive" } },
            }),
            (token) => ({
              course: {
                teacher: { user: { fullLegalName: { contains: token, mode: "insensitive" } } },
              },
            }),
            (token) => ({
              course: { teacher: { user: { phone: { contains: token } } } },
            }),
          ])
        : [];

    const where: Prisma.CourseLessonWhereInput = {
      OR: [{ fileKey: { not: null } }, { fileUrl: { not: null } }, { videoAssetId: { not: null } }],
      ...visibilityWhere(visibility),
      ...(filters.courseStatus ? { course: { status: filters.courseStatus, deletedAt: null } } : {}),
      ...(searchClauses.length > 0 ? { AND: searchClauses } : {}),
    };

    const orderBy =
      filters.sort === "oldest"
        ? { createdAt: "asc" as const }
        : filters.sort === "title"
          ? { title: "asc" as const }
          : { createdAt: "desc" as const };

    const lessons = await prisma.courseLesson.findMany({
      where,
      orderBy,
      take: 200,
      include: {
        course: {
          select: {
            id: true,
            titleEn: true,
            status: true,
            teacher: {
              select: {
                id: true,
                level: true,
                user: { select: { fullLegalName: true, phone: true } },
              },
            },
          },
        },
        _count: { select: { likes: true, favorites: true } },
      },
    });

    return Promise.all(
      lessons.map(async (lesson) => ({
        ...lesson,
        fileUrl: await resolveVideoUrl(lesson.fileKey, lesson.fileUrl),
      }))
    );
  }

  static async setHidden(lessonId: string, actorId: string, hidden: boolean) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: {
        course: {
          select: {
            titleEn: true,
            teacher: { select: { userId: true } },
          },
        },
      },
    });
    if (!lesson) return { success: false as const, error: "NOT_FOUND" };

    const updated = await prisma.courseLesson.update({
      where: { id: lessonId },
      data: { isHidden: hidden },
    });

    await LoggingService.log({
      actorId,
      action: hidden ? "COURSE_LESSON_HIDDEN" : "COURSE_LESSON_UNHIDDEN",
      entityType: "CourseLesson",
      entityId: lessonId,
      newValue: { courseId: lesson.courseId, hidden },
    });

    await NotificationService.notifyUser(lesson.course.teacher.userId, {
      titleEn: hidden ? "Course video hidden" : "Course video visible again",
      titleAr: hidden ? "تم إخفاء فيديو الدرس" : "فيديو الدرس ظاهر مجدداً",
      titleKu: hidden ? "ڤیدیۆی وانە شاردرایەوە" : "ڤیدیۆی وانە دووبارە دیارە",
      titleTr: hidden ? "Ders videosu gizlendi" : "Ders videosu yeniden görünür",
      bodyEn: hidden
        ? `"${lesson.title}" in ${lesson.course.titleEn} is hidden from students.`
        : `"${lesson.title}" in ${lesson.course.titleEn} is visible to students again.`,
      bodyAr: hidden
        ? `"${lesson.title}" في ${lesson.course.titleEn} مخفي عن الطلاب.`
        : `"${lesson.title}" في ${lesson.course.titleEn} ظاهر للطلاب مجدداً.`,
      bodyKu: hidden
        ? `"${lesson.title}" لە ${lesson.course.titleEn} لە قوتابیان شاردراوەتەوە.`
        : `"${lesson.title}" لە ${lesson.course.titleEn} دووبارە بۆ قوتابیان دیارە.`,
      bodyTr: hidden
        ? `"${lesson.title}" (${lesson.course.titleEn}) öğrencilerden gizlendi.`
        : `"${lesson.title}" (${lesson.course.titleEn}) öğrencilere yeniden açıldı.`,
    }).catch(() => {});

    return { success: true as const, lesson: updated };
  }

  static async softDelete(lessonId: string, actorId: string) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: {
        course: {
          select: {
            titleEn: true,
            teacher: { select: { userId: true } },
          },
        },
      },
    });
    if (!lesson) return { success: false as const, error: "NOT_FOUND" };

    const updated = await prisma.courseLesson.update({
      where: { id: lessonId },
      data: { deletedAt: new Date(), isHidden: true },
    });

    await LoggingService.log({
      actorId,
      action: "COURSE_LESSON_DELETED",
      entityType: "CourseLesson",
      entityId: lessonId,
      newValue: { courseId: lesson.courseId },
    });

    await NotificationService.notifyUser(lesson.course.teacher.userId, {
      titleEn: "Course video removed",
      titleAr: "تم حذف فيديو الدرس",
      titleKu: "ڤیدیۆی وانە سڕایەوە",
      titleTr: "Ders videosu kaldırıldı",
      bodyEn: `"${lesson.title}" was removed from ${lesson.course.titleEn} by an administrator.`,
      bodyAr: `تم حذف "${lesson.title}" من ${lesson.course.titleEn} بواسطة المشرف.`,
      bodyKu: `"${lesson.title}" لە ${lesson.course.titleEn} لەلایەن بەڕێوەبەرەوە سڕایەوە.`,
      bodyTr: `"${lesson.title}" (${lesson.course.titleEn}) bir yönetici tarafından kaldırıldı.`,
    }).catch(() => {});

    return { success: true as const, lesson: updated };
  }

  static async restore(lessonId: string, actorId: string) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: lessonId, deletedAt: { not: null } },
    });
    if (!lesson) return { success: false as const, error: "NOT_FOUND" };

    const updated = await prisma.courseLesson.update({
      where: { id: lessonId },
      data: { deletedAt: null, isHidden: false },
    });

    await LoggingService.log({
      actorId,
      action: "COURSE_LESSON_RESTORED",
      entityType: "CourseLesson",
      entityId: lessonId,
    });

    return { success: true as const, lesson: updated };
  }
}
