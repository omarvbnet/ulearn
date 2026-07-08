import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";

async function resolveVideoUrl(fileKey: string | null, fileUrl: string | null) {
  if (fileUrl) return fileUrl;
  if (fileKey) return getDownloadUrl(fileKey).catch(() => null);
  return null;
}

export class ShortVideoService {
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
      page.map(async (v) => ({
        id: v.id,
        title: v.title,
        description: v.description,
        fileUrl: await resolveVideoUrl(v.fileKey, v.fileUrl),
        thumbnailUrl: v.thumbnailUrl,
        durationSec: v.durationSec,
        createdAt: v.createdAt,
        teacher: {
          id: v.teacher.id,
          name: v.teacher.user.fullLegalName,
          level: v.teacher.level,
          profilePhotoUrl: v.teacher.user.profilePhotoUrl,
        },
        likes: v._count.likes,
        commentCount: v._count.comments,
        likedByMe: v.likes.length > 0,
      }))
    );

    return {
      videos: mapped.filter((v) => v.fileUrl),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  static async listComments(videoId: string, limit = 50) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, status: "APPROVED", deletedAt: null },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" as const };

    const comments = await prisma.shortVideoComment.findMany({
      where: { videoId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { id: true, fullLegalName: true } },
      },
    });

    return { success: true as const, comments };
  }

  static async addComment(params: {
    videoId: string;
    userId: string;
    body: string;
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

    const comment = await prisma.shortVideoComment.create({
      data: {
        videoId: params.videoId,
        userId: params.userId,
        body: params.body.trim(),
      },
      include: {
        user: { select: { id: true, fullLegalName: true } },
      },
    });

    return { success: true as const, comment, teacherUserId: video.teacher.userId, videoTitle: video.title };
  }
}
