import { prisma } from "@/lib/prisma";
import { NotificationService } from "@/services/notification.service";
import { LoggingService } from "@/services/logging.service";
import { getDownloadUrl } from "@/lib/r2";
import type { CourseStatus } from "@prisma/client";

async function resolveVideoUrl(fileKey: string | null, fileUrl: string | null) {
  if (fileUrl) return fileUrl;
  if (fileKey) return getDownloadUrl(fileKey).catch(() => null);
  return null;
}

export class ShortVideoAdminService {
  static async listForReview(status: CourseStatus = "PENDING_REVIEW") {
    const videos = await prisma.teacherShortVideo.findMany({
      where: { status, deletedAt: null },
      orderBy: { createdAt: "desc" },
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
}
