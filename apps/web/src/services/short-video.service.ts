import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";

async function resolveVideoUrl(fileKey: string | null, fileUrl: string | null) {
  if (fileUrl) return fileUrl;
  if (fileKey) return getDownloadUrl(fileKey).catch(() => null);
  return null;
}

const userSelect = {
  id: true,
  fullLegalName: true,
  profilePhotoUrl: true,
} as const;

export class ShortVideoService {
  static async mapVideo(
    v: {
      id: string;
      title: string;
      description: string | null;
      fileKey: string | null;
      fileUrl: string | null;
      thumbnailUrl: string | null;
      durationSec: number | null;
      viewCount: number;
      createdAt: Date;
      teacher: {
        id: string;
        userId: string;
        level: string;
        user: { fullLegalName: string | null; profilePhotoUrl: string | null };
      };
      _count?: { likes: number; comments: number };
      likes?: { id: string }[];
    },
    userId?: string
  ) {
    return {
      id: v.id,
      title: v.title,
      description: v.description,
      fileUrl: await resolveVideoUrl(v.fileKey, v.fileUrl),
      thumbnailUrl: v.thumbnailUrl,
      durationSec: v.durationSec,
      viewCount: v.viewCount,
      createdAt: v.createdAt,
      teacher: {
        id: v.teacher.id,
        userId: v.teacher.userId,
        name: v.teacher.user.fullLegalName,
        level: v.teacher.level,
        profilePhotoUrl: v.teacher.user.profilePhotoUrl,
      },
      likes: v._count?.likes ?? 0,
      commentCount: v._count?.comments ?? 0,
      likedByMe: userId ? (v.likes?.length ?? 0) > 0 : false,
    };
  }

  static async listFeed(params: {
    userId: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(params.limit ?? 10, 30);
    const cursor = params.cursor
      ? await prisma.teacherShortVideo.findUnique({
          where: { id: params.cursor },
          select: { createdAt: true },
        })
      : null;

    const videos = await prisma.teacherShortVideo.findMany({
      where: {
        status: "APPROVED",
        deletedAt: null,
        OR: [{ fileUrl: { not: null } }, { fileKey: { not: null } }],
        ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        teacher: {
          select: {
            id: true,
            userId: true,
            level: true,
            user: { select: { fullLegalName: true, profilePhotoUrl: true } },
          },
        },
        _count: {
          select: {
            likes: true,
            comments: { where: { deletedAt: null } },
          },
        },
        likes: { where: { userId: params.userId }, select: { id: true }, take: 1 },
      },
    });

    const hasMore = videos.length > limit;
    const page = hasMore ? videos.slice(0, limit) : videos;

    const mapped = await Promise.all(
      page.map((v) => this.mapVideo(v, params.userId))
    );

    return {
      videos: mapped.filter((v) => v.fileUrl),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  static async listForTeacher(teacherId: string, userId: string) {
    const videos = await prisma.teacherShortVideo.findMany({
      where: { teacherId, status: "APPROVED", deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        teacher: {
          select: {
            id: true,
            userId: true,
            level: true,
            user: { select: { fullLegalName: true, profilePhotoUrl: true } },
          },
        },
        _count: {
          select: {
            likes: true,
            comments: { where: { deletedAt: null } },
          },
        },
        likes: { where: { userId }, select: { id: true }, take: 1 },
      },
    });

    const mapped = await Promise.all(videos.map((v) => this.mapVideo(v, userId)));
    return mapped.filter((v) => v.fileUrl);
  }

  static async incrementView(videoId: string) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, status: "APPROVED", deletedAt: null },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" as const };

    const updated = await prisma.teacherShortVideo.update({
      where: { id: videoId },
      data: { viewCount: { increment: 1 } },
      select: { viewCount: true },
    });

    return { success: true as const, viewCount: updated.viewCount };
  }

  static async deleteForTeacher(videoId: string, userId: string) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, deletedAt: null },
      include: { teacher: { select: { userId: true } } },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" as const };
    if (video.teacher.userId !== userId) {
      return { success: false as const, error: "FORBIDDEN" as const };
    }

    await prisma.teacherShortVideo.update({
      where: { id: videoId },
      data: { deletedAt: new Date() },
    });

    return { success: true as const };
  }

  static async listComments(videoId: string, limit = 50) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, status: "APPROVED", deletedAt: null },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" as const };

    const comments = await prisma.shortVideoComment.findMany({
      where: { videoId, deletedAt: null, parentId: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: userSelect },
        replies: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          include: { user: { select: userSelect } },
        },
      },
    });

    return { success: true as const, comments };
  }

  static async addComment(params: {
    videoId: string;
    userId: string;
    body: string;
    parentId?: string;
  }) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: params.videoId, status: "APPROVED", deletedAt: null },
      select: {
        id: true,
        title: true,
        teacher: { select: { userId: true } },
      },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" as const };

    if (params.parentId) {
      const parent = await prisma.shortVideoComment.findFirst({
        where: {
          id: params.parentId,
          videoId: params.videoId,
          deletedAt: null,
          parentId: null,
        },
      });
      if (!parent) return { success: false as const, error: "INVALID_PARENT" as const };
    }

    const comment = await prisma.shortVideoComment.create({
      data: {
        videoId: params.videoId,
        userId: params.userId,
        body: params.body.trim(),
        parentId: params.parentId ?? null,
      },
      include: {
        user: { select: userSelect },
        replies: {
          where: { deletedAt: null },
          include: { user: { select: userSelect } },
        },
      },
    });

    return {
      success: true as const,
      comment,
      teacherUserId: video.teacher.userId,
      videoTitle: video.title,
    };
  }
}
