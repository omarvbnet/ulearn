import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";
import {
  buildTokenAndClauses,
  parseAdminVisibility,
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

export type ShortVideoAdminFilters = {
  status?: CourseStatus;
  q?: string;
  visibility?: AdminVisibilityFilter;
  sort?: "newest" | "oldest" | "engagement";
};

export class ShortVideoAdminService {
  static async list(filters: ShortVideoAdminFilters = {}) {
    const visibility = filters.visibility ?? "visible";
    const tokens = tokenizeSearch(filters.q ?? "");

    const searchClauses =
      tokens.length > 0
        ? buildTokenAndClauses<Prisma.TeacherShortVideoWhereInput>(tokens, [
            (token) => ({ title: { contains: token, mode: "insensitive" } }),
            (token) => ({ description: { contains: token, mode: "insensitive" } }),
            (token) => ({
              teacher: { user: { fullLegalName: { contains: token, mode: "insensitive" } } },
            }),
            (token) => ({ teacher: { user: { phone: { contains: token } } } }),
          ])
        : [];

    const where: Prisma.TeacherShortVideoWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...parseVisibilityWhere(visibility),
      ...(searchClauses.length > 0 ? { AND: searchClauses } : {}),
    };

    const orderBy =
      filters.sort === "oldest"
        ? { createdAt: "asc" as const }
        : filters.sort === "engagement"
          ? [{ likes: { _count: "desc" as const } }, { createdAt: "desc" as const }]
          : { createdAt: "desc" as const };

    const videos = await prisma.teacherShortVideo.findMany({
      where,
      orderBy,
      take: 200,
      include: {
        teacher: {
          select: {
            id: true,
            level: true,
            user: { select: { fullLegalName: true, phone: true } },
          },
        },
        _count: { select: { likes: true, comments: true } },
      },
    });

    return Promise.all(
      videos.map(async (v) => ({
        ...v,
        fileUrl: await resolveVideoUrl(v.fileKey, v.fileUrl),
      }))
    );
  }

  static async review(
    videoId: string,
    actorId: string,
    decision: "APPROVED" | "REJECTED",
    notes?: string
  ) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, deletedAt: null },
      include: { teacher: { select: { userId: true } } },
    });
    if (!video || video.status !== "PENDING_REVIEW") {
      return { success: false as const, error: "NOT_FOUND" };
    }

    const updated = await prisma.teacherShortVideo.update({
      where: { id: videoId },
      data: {
        status: decision,
        reviewNotes: notes ?? null,
        reviewedAt: new Date(),
        isHidden: false,
      },
    });

    await LoggingService.log({
      actorId,
      action: `SHORT_VIDEO_${decision}`,
      entityType: "TeacherShortVideo",
      entityId: videoId,
      newValue: { status: decision, notes },
    });

    await NotificationService.notifyUser(video.teacher.userId, {
      titleEn: decision === "APPROVED" ? "Short video approved" : "Short video rejected",
      titleAr: decision === "APPROVED" ? "تمت الموافقة على الفيديو القصير" : "تم رفض الفيديو القصير",
      titleKu: decision === "APPROVED" ? "ڤیدیۆی کورت پەسەند کرا" : "ڤیدیۆی کورت ڕەتکرایەوە",
      titleTr: decision === "APPROVED" ? "Kısa video onaylandı" : "Kısa video reddedildi",
      bodyEn:
        decision === "APPROVED"
          ? `"${video.title}" is now live in Reels.`
          : notes || `"${video.title}" was not approved.`,
      bodyAr:
        decision === "APPROVED"
          ? `"${video.title}" متاح الآن في Reels.`
          : notes || `لم تتم الموافقة على "${video.title}".`,
      bodyKu:
        decision === "APPROVED"
          ? `"${video.title}" ئێستا لە Reels دا بەردەستە.`
          : notes || `"${video.title}" پەسەند نەکرا.`,
      bodyTr:
        decision === "APPROVED"
          ? `"${video.title}" artık Reels'te yayında.`
          : notes || `"${video.title}" onaylanmadı.`,
    }).catch(() => {});

    return { success: true as const, video: updated };
  }

  static async setHidden(videoId: string, actorId: string, hidden: boolean) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, deletedAt: null },
      include: { teacher: { select: { userId: true } } },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" };

    const updated = await prisma.teacherShortVideo.update({
      where: { id: videoId },
      data: { isHidden: hidden },
    });

    await LoggingService.log({
      actorId,
      action: hidden ? "SHORT_VIDEO_HIDDEN" : "SHORT_VIDEO_UNHIDDEN",
      entityType: "TeacherShortVideo",
      entityId: videoId,
    });

    await NotificationService.notifyUser(video.teacher.userId, {
      titleEn: hidden ? "Short video hidden" : "Short video visible again",
      titleAr: hidden ? "تم إخفاء الفيديو القصير" : "الفيديو القصير ظاهر مجدداً",
      titleKu: hidden ? "ڤیدیۆی کورت شاردرایەوە" : "ڤیدیۆی کورت دووبارە دیارە",
      titleTr: hidden ? "Kısa video gizlendi" : "Kısa video yeniden görünür",
      bodyEn: hidden
        ? `"${video.title}" is hidden from students until an admin restores it.`
        : `"${video.title}" is live in Reels again.`,
      bodyAr: hidden
        ? `"${video.title}" مخفي عن الطلاب حتى يعيده المشرف.`
        : `"${video.title}" متاح مجدداً في Reels.`,
      bodyKu: hidden
        ? `"${video.title}" لە قوتابیان شاردراوەتەوە تا بەڕێوەبەر بیگەڕێنێتەوە.`
        : `"${video.title}" دووبارە لە Reels دا بەردەستە.`,
      bodyTr: hidden
        ? `"${video.title}" yönetici geri alana kadar öğrencilerden gizlendi.`
        : `"${video.title}" Reels'te yeniden yayında.`,
    }).catch(() => {});

    return { success: true as const, video: updated };
  }

  static async softDelete(videoId: string, actorId: string) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, deletedAt: null },
      include: { teacher: { select: { userId: true } } },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" };

    const updated = await prisma.teacherShortVideo.update({
      where: { id: videoId },
      data: { deletedAt: new Date(), isHidden: true },
    });

    await LoggingService.log({
      actorId,
      action: "SHORT_VIDEO_DELETED",
      entityType: "TeacherShortVideo",
      entityId: videoId,
    });

    await NotificationService.notifyUser(video.teacher.userId, {
      titleEn: "Short video removed",
      titleAr: "تم حذف الفيديو القصير",
      titleKu: "ڤیدیۆی کورت سڕایەوە",
      titleTr: "Kısa video kaldırıldı",
      bodyEn: `"${video.title}" was removed by an administrator.`,
      bodyAr: `تم حذف "${video.title}" بواسطة المشرف.`,
      bodyKu: `"${video.title}" لەلایەن بەڕێوەبەرەوە سڕایەوە.`,
      bodyTr: `"${video.title}" bir yönetici tarafından kaldırıldı.`,
    }).catch(() => {});

    return { success: true as const, video: updated };
  }

  static async restore(videoId: string, actorId: string) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, deletedAt: { not: null } },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" };

    const updated = await prisma.teacherShortVideo.update({
      where: { id: videoId },
      data: { deletedAt: null, isHidden: false },
    });

    await LoggingService.log({
      actorId,
      action: "SHORT_VIDEO_RESTORED",
      entityType: "TeacherShortVideo",
      entityId: videoId,
    });

    return { success: true as const, video: updated };
  }
}

function parseVisibilityWhere(visibility: AdminVisibilityFilter) {
  switch (visibility) {
    case "hidden":
      return { deletedAt: null, isHidden: true };
    case "deleted":
      return { deletedAt: { not: null } };
    case "all":
      return {};
    case "visible":
    default:
      return { deletedAt: null, isHidden: false };
  }
}

export { parseAdminVisibility };
