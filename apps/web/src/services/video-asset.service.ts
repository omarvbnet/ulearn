import { randomUUID } from "crypto";
import type { UserRole, VideoScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { VideoAssetRepository } from "@/repositories/video-asset.repository";
import {
  buildShortVideoDeliveryKey,
  buildVideoDeliveryKey,
  getVideoUploadUrl,
  headVideoObject,
} from "@/lib/r2-video";

const repo = new VideoAssetRepository();

const UPLOAD_ROLES: UserRole[] = ["SUPER_ADMIN", "COUNTRY_ADMIN", "TEACHER"];

export class VideoAssetService {
  static canUpload(role: UserRole) {
    return UPLOAD_ROLES.includes(role);
  }

  static async createUploadSession(params: {
    userId: string;
    role: UserRole;
    scope: VideoScope;
    courseId?: string;
    filename: string;
    contentType: string;
    size: number;
  }) {
    if (!this.canUpload(params.role)) throw new Error("FORBIDDEN");
    if (params.scope !== "SHORT_VIDEO" && !params.courseId) throw new Error("COURSE_REQUIRED");

    const videoId = randomUUID();
    const objectKey =
      params.scope === "SHORT_VIDEO"
        ? buildShortVideoDeliveryKey(videoId)
        : buildVideoDeliveryKey(params.courseId!, videoId);

    const asset = await repo.create({
      scope: params.scope,
      ...(params.courseId ? { courseId: params.courseId } : {}),
      uploadedBy: { connect: { id: params.userId } },
      objectKey,
      sourceFilename: params.filename,
      fileSize: BigInt(params.size),
      processingStatus: "PENDING_UPLOAD",
    });

    const upload = await getVideoUploadUrl({
      key: objectKey,
      contentType: "video/mp4",
      size: params.size,
      filename: params.filename,
    });

    return {
      videoId: asset.id,
      objectKey,
      uploadUrl: upload.uploadUrl,
      expiresIn: upload.expiresIn,
      expiresAt: new Date(Date.now() + upload.expiresIn * 1000).toISOString(),
    };
  }

  static async completeUpload(params: {
    videoId: string;
    userId: string;
    size?: number;
    durationSec?: number;
    width?: number;
    height?: number;
    watermarkApplied?: boolean;
    courseLessonId?: string;
  }) {
    const asset = await repo.findById(params.videoId);
    if (!asset) throw new Error("NOT_FOUND");
    if (asset.uploadedById !== params.userId) throw new Error("FORBIDDEN");
    if (asset.processingStatus !== "PENDING_UPLOAD") throw new Error("INVALID_STATE");

    const head = await headVideoObject(asset.objectKey);
    if (head.size <= 0) throw new Error("UPLOAD_INCOMPLETE");
    if (params.size && Math.abs(head.size - params.size) > 2048) {
      throw new Error("SIZE_MISMATCH");
    }

    const updated = await repo.update(params.videoId, {
      fileSize: BigInt(head.size),
      durationSec: params.durationSec,
      width: params.width,
      height: params.height,
      watermarkApplied: params.watermarkApplied ?? false,
      videoCodec: "h264",
      audioCodec: "aac",
      uploadedAt: new Date(),
      processingStatus: "READY",
    });

    if (params.courseLessonId && asset.courseId) {
      await prisma.courseLesson.update({
        where: { id: params.courseLessonId },
        data: {
          videoAssetId: params.videoId,
          fileKey: asset.objectKey,
        },
      });
      await repo.update(params.videoId, {
        courseLessonId: params.courseLessonId,
      });
    }

    return updated;
  }
}
