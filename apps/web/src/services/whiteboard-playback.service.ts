import { prisma } from "@/lib/prisma";
import { PUBLIC_LESSON_WHERE } from "@/lib/video-visibility";
import { getDownloadUrl } from "@/lib/r2";
import { WHITEBOARD_PLAYBACK_EXPIRES_SEC } from "@/lib/r2-whiteboard";
import { WhiteboardAssetRepository } from "@/repositories/whiteboard-asset.repository";

const repo = new WhiteboardAssetRepository();

export type WhiteboardPlaybackResponse = {
  whiteboardId: string;
  playbackType: "ubrd";
  packageUrl: string;
  expiresAt: string;
  expiresIn: number;
  refreshUrl: string;
  durationSec: number | null;
  theme: string;
  schemaVersion: number;
};

export class WhiteboardPlaybackService {
  static async authorizeAndGetPlayback(
    whiteboardId: string,
    userId: string,
    role: string
  ): Promise<WhiteboardPlaybackResponse> {
    const asset = await repo.findById(whiteboardId);
    if (!asset) throw new Error("NOT_FOUND");
    if (asset.processingStatus !== "READY") throw new Error("NOT_READY");

    const allowed = await this.canWatch(asset, userId, role);
    if (!allowed) throw new Error("FORBIDDEN");

    const expiresIn = WHITEBOARD_PLAYBACK_EXPIRES_SEC;
    const packageUrl = await getDownloadUrl(asset.objectKey, expiresIn);

    return {
      whiteboardId: asset.id,
      playbackType: "ubrd",
      packageUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      expiresIn,
      refreshUrl: `/api/whiteboards/${whiteboardId}/refresh`,
      durationSec: asset.durationSec,
      theme: asset.theme,
      schemaVersion: asset.schemaVersion,
    };
  }

  static async getStoreLessonPackageUrl(userId: string, lessonId: string) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: lessonId, ...PUBLIC_LESSON_WHERE, course: { deletedAt: null } },
      include: {
        course: { select: { id: true, price: true, teacher: { select: { userId: true } } } },
        whiteboardAsset: true,
      },
    });
    if (!lesson || lesson.lessonType !== "WHITEBOARD") {
      return { ok: false as const, error: "NOT_FOUND" };
    }

    const purchased = await prisma.coursePurchase.findFirst({
      where: { userId, courseId: lesson.courseId, status: "PAID" },
    });
    const isOwner = lesson.course.teacher.userId === userId;
    const isFree = lesson.course.price <= 0 || lesson.isFreePreview;
    const timedFree =
      !lesson.isFreePreview &&
      typeof lesson.freePreviewSec === "number" &&
      lesson.freePreviewSec > 0;
    if (!purchased && !isFree && !isOwner && !timedFree) {
      return { ok: false as const, error: "NO_ACCESS" };
    }

    const key = lesson.whiteboardAsset?.objectKey ?? lesson.fileKey;
    if (!key || lesson.whiteboardAsset?.processingStatus === "PENDING_UPLOAD") {
      return { ok: false as const, error: "NOT_FOUND" };
    }

    const url = await getDownloadUrl(key, WHITEBOARD_PLAYBACK_EXPIRES_SEC);
    return {
      ok: true as const,
      url,
      durationSec: lesson.whiteboardAsset?.durationSec ?? lesson.durationSec,
      theme: lesson.whiteboardAsset?.theme ?? "WHITE",
      whiteboardId: lesson.whiteboardAsset?.id ?? null,
    };
  }

  private static async canWatch(
    asset: NonNullable<Awaited<ReturnType<WhiteboardAssetRepository["findById"]>>>,
    userId: string,
    role: string
  ) {
    if (["SUPER_ADMIN", "COUNTRY_ADMIN"].includes(role)) return true;
    if (asset.uploadedById === userId) return true;

    if (asset.courseId) {
      const lesson = asset.courseLesson;
      if (lesson?.isFreePreview) return true;
      if (
        lesson &&
        !lesson.isFreePreview &&
        typeof lesson.freePreviewSec === "number" &&
        lesson.freePreviewSec > 0
      ) {
        return true;
      }

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
