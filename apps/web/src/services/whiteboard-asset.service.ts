import { randomUUID } from "crypto";
import type { UserRole, WhiteboardTheme } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { WhiteboardAssetRepository } from "@/repositories/whiteboard-asset.repository";
import {
  buildWhiteboardPackageKey,
  getWhiteboardUploadUrl,
  headWhiteboardObject,
} from "@/lib/r2-whiteboard";

const repo = new WhiteboardAssetRepository();

const UPLOAD_ROLES: UserRole[] = ["SUPER_ADMIN", "COUNTRY_ADMIN", "TEACHER"];

export class WhiteboardAssetService {
  static canUpload(role: UserRole) {
    return UPLOAD_ROLES.includes(role);
  }

  static async createUploadSession(params: {
    userId: string;
    role: UserRole;
    courseId: string;
    filename: string;
    contentType: string;
    size: number;
    theme?: WhiteboardTheme;
  }) {
    if (!this.canUpload(params.role)) throw new Error("FORBIDDEN");
    if (!params.courseId) throw new Error("COURSE_REQUIRED");

    const assetId = randomUUID();
    const objectKey = buildWhiteboardPackageKey(params.courseId, assetId);

    const asset = await repo.create({
      courseId: params.courseId,
      uploadedBy: { connect: { id: params.userId } },
      objectKey,
      sourceFilename: params.filename,
      fileSize: BigInt(params.size),
      theme: params.theme ?? "WHITE",
      processingStatus: "PENDING_UPLOAD",
    });

    const upload = await getWhiteboardUploadUrl({
      key: objectKey,
      contentType: params.contentType || "application/octet-stream",
      size: params.size,
      filename: params.filename,
    });

    return {
      whiteboardId: asset.id,
      objectKey,
      uploadUrl: upload.uploadUrl,
      expiresIn: upload.expiresIn,
      expiresAt: new Date(Date.now() + upload.expiresIn * 1000).toISOString(),
    };
  }

  static async completeUpload(params: {
    whiteboardId: string;
    userId: string;
    size?: number;
    durationSec?: number;
    theme?: WhiteboardTheme;
    thumbnailKey?: string;
    schemaVersion?: number;
    courseLessonId?: string;
  }) {
    const asset = await repo.findById(params.whiteboardId);
    if (!asset) throw new Error("NOT_FOUND");
    if (asset.uploadedById !== params.userId) throw new Error("FORBIDDEN");
    if (asset.processingStatus !== "PENDING_UPLOAD") throw new Error("INVALID_STATE");

    const head = await headWhiteboardObject(asset.objectKey);
    if (head.size <= 0) throw new Error("UPLOAD_INCOMPLETE");
    if (params.size && Math.abs(head.size - params.size) > 4096) {
      throw new Error("SIZE_MISMATCH");
    }

    const updated = await repo.update(params.whiteboardId, {
      fileSize: BigInt(head.size),
      durationSec: params.durationSec,
      theme: params.theme,
      thumbnailKey: params.thumbnailKey,
      schemaVersion: params.schemaVersion ?? 1,
      uploadedAt: new Date(),
      processingStatus: "READY",
    });

    if (params.courseLessonId && asset.courseId) {
      await prisma.courseLesson.update({
        where: { id: params.courseLessonId },
        data: {
          lessonType: "WHITEBOARD",
          whiteboardAssetId: params.whiteboardId,
          durationSec: params.durationSec ?? undefined,
          fileKey: asset.objectKey,
        },
      });
      await repo.update(params.whiteboardId, {
        courseLessonId: params.courseLessonId,
      });
    }

    return updated;
  }
}
