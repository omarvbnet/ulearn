import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";
import { VIDEO_PLAYBACK_EXPIRES_SEC } from "@/lib/r2-video";
import { VideoAssetRepository } from "@/repositories/video-asset.repository";

const repo = new VideoAssetRepository();

export type PlaybackResponse = {
  videoId: string;
  playbackType: "mp4";
  playbackUrl: string;
  expiresAt: string;
  expiresIn: number;
  refreshUrl: string;
  durationSec: number | null;
  watermarkApplied: boolean;
};

export class VideoPlaybackService {
  static async authorizeAndGetPlayback(
    videoId: string,
    userId: string,
    role: string
  ): Promise<PlaybackResponse> {
    const asset = await repo.findById(videoId);
    if (!asset) throw new Error("NOT_FOUND");
    if (asset.processingStatus !== "READY") throw new Error("NOT_READY");

    const allowed = await this.canWatch(asset, userId, role);
    if (!allowed) throw new Error("FORBIDDEN");

    const expiresIn = VIDEO_PLAYBACK_EXPIRES_SEC;
    const playbackUrl = await getDownloadUrl(asset.objectKey, expiresIn);

    return {
      videoId: asset.id,
      playbackType: "mp4",
      playbackUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      expiresIn,
      refreshUrl: `/api/videos/${videoId}/refresh`,
      durationSec: asset.durationSec,
      watermarkApplied: asset.watermarkApplied,
    };
  }

  /** Signed URL for a store lesson (legacy fileKey or VideoAsset). */
  static async getStoreLessonPlaybackUrl(userId: string, lessonId: string) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: lessonId, course: { deletedAt: null } },
      include: {
        course: { select: { id: true, price: true, teacher: { select: { userId: true } } } },
        videoAsset: true,
      },
    });
    if (!lesson) return { ok: false as const, error: "NOT_FOUND" };

    const purchased = await prisma.coursePurchase.findFirst({
      where: { userId, courseId: lesson.courseId, status: "PAID" },
    });
    const isOwner = lesson.course.teacher.userId === userId;
    const isFree = lesson.course.price <= 0 || lesson.isFreePreview;
    if (!purchased && !isFree && !isOwner) {
      return { ok: false as const, error: "NO_ACCESS" };
    }

    const key = lesson.videoAsset?.objectKey ?? lesson.fileKey;
    if (!key) return { ok: false as const, error: "NOT_FOUND" };

    const url = await getDownloadUrl(key, VIDEO_PLAYBACK_EXPIRES_SEC);
    return {
      ok: true as const,
      url,
      watermarkApplied: lesson.videoAsset?.watermarkApplied ?? false,
    };
  }

  static async getCurriculumLessonPlaybackUrl(
    userId: string,
    lessonId: string,
    contentId?: string
  ) {
    const { CourseService } = await import("@/services/course.service");
    const result = await CourseService.getLesson(lessonId, userId);
    if (!result || !result.hasAccess) return { ok: false as const, error: "NO_ACCESS" };

    const video =
      result.lesson.contents.find((c) => c.id === contentId && c.type === "VIDEO") ??
      result.lesson.contents.find((c) => c.type === "VIDEO");
    if (!video?.fileKey) return { ok: false as const, error: "NOT_FOUND" };

    const url = await getDownloadUrl(video.fileKey, VIDEO_PLAYBACK_EXPIRES_SEC);
    return { ok: true as const, url, watermarkApplied: true };
  }

  private static async canWatch(
    asset: NonNullable<Awaited<ReturnType<VideoAssetRepository["findById"]>>>,
    userId: string,
    role: string
  ) {
    if (["SUPER_ADMIN", "COUNTRY_ADMIN"].includes(role)) return true;
    if (asset.uploadedById === userId) return true;

    if (asset.scope === "STORE_COURSE" && asset.courseId) {
      const lesson = asset.courseLesson;
      if (lesson?.isFreePreview) return true;

      const purchase = await prisma.coursePurchase.findFirst({
        where: { courseId: asset.courseId, userId, status: "PAID" },
      });
      if (purchase) return true;

      const course = await prisma.course.findFirst({
        where: { id: asset.courseId, deletedAt: null },
      });
      if (course && course.price <= 0) return true;
    }

    return false;
  }
}
