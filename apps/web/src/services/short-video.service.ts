import { prisma } from "@/lib/prisma";
import { PUBLIC_SHORT_VIDEO_WHERE } from "@/lib/video-visibility";
import { resolvePublicMediaUrl, resolveSignedMediaUrl } from "@/lib/r2";

async function resolveVideoUrl(fileKey: string | null, fileUrl: string | null) {
  if (fileUrl?.startsWith("http") && !fileUrl.includes("/uploads/")) {
    // Prefer re-signing from key when available so private buckets still play.
    if (fileKey) return resolveSignedMediaUrl(fileUrl, fileKey);
    return fileUrl;
  }
  return resolveSignedMediaUrl(fileUrl, fileKey);
}

const userSelect = {
  id: true,
  fullLegalName: true,
  profilePhotoUrl: true,
  profilePhotoKey: true,
} as const;

const FRESH_BOOST_MS = 2 * 60 * 60 * 1000;
const SCORE_LIKE_WEIGHT = 3;
const SCORE_SAVE_WEIGHT = 5;
const SCORE_SUBSCRIBER_WEIGHT = 2;

type RawVideo = {
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
    user: {
      fullLegalName: string | null;
      profilePhotoUrl: string | null;
      profilePhotoKey?: string | null;
    };
  };
  _count?: { likes: number; comments: number; saves: number };
  likes?: { id: string }[];
  saves?: { id: string }[];
  teacherSubscriberCount?: number;
};

export class ShortVideoService {
  static async mapVideo(v: RawVideo, userId?: string) {
    const [fileUrl, thumbnailUrl, profilePhotoUrl] = await Promise.all([
      resolveVideoUrl(v.fileKey, v.fileUrl),
      resolvePublicMediaUrl(v.thumbnailUrl, null),
      resolvePublicMediaUrl(
        v.teacher.user.profilePhotoUrl,
        v.teacher.user.profilePhotoKey ?? null
      ),
    ]);
    return {
      id: v.id,
      title: v.title,
      description: v.description,
      fileUrl,
      thumbnailUrl: thumbnailUrl ?? v.thumbnailUrl,
      durationSec: v.durationSec,
      viewCount: v.viewCount,
      createdAt: v.createdAt,
      teacher: {
        id: v.teacher.id,
        userId: v.teacher.userId,
        name: v.teacher.user.fullLegalName,
        level: v.teacher.level,
        profilePhotoUrl: profilePhotoUrl ?? v.teacher.user.profilePhotoUrl,
      },
      likes: v._count?.likes ?? 0,
      saves: v._count?.saves ?? 0,
      commentCount: v._count?.comments ?? 0,
      likedByMe: userId ? (v.likes?.length ?? 0) > 0 : false,
      savedByMe: userId ? (v.saves?.length ?? 0) > 0 : false,
    };
  }

  private static videoInclude(userId?: string) {
    return {
      teacher: {
        select: {
          id: true,
          userId: true,
          level: true,
          user: {
            select: {
              fullLegalName: true,
              profilePhotoUrl: true,
              profilePhotoKey: true,
            },
          },
        },
      },
      _count: {
        select: {
          likes: true,
          saves: true,
          comments: { where: { deletedAt: null } },
        },
      },
      ...(userId
        ? {
            likes: { where: { userId }, select: { id: true }, take: 1 },
            saves: { where: { userId }, select: { id: true }, take: 1 },
          }
        : {}),
    } as const;
  }

  /**
   * Score for ranking after the 2-hour fresh window expires.
   * likes × 3 + views + saves × 5 + teacher subscribers × 2
   */
  private static engagementScore(v: {
    viewCount: number;
    _count?: { likes: number; saves: number };
    teacherSubscriberCount?: number;
  }) {
    const likes = v._count?.likes ?? 0;
    const saves = v._count?.saves ?? 0;
    const subscribers = v.teacherSubscriberCount ?? 0;
    return (
      likes * SCORE_LIKE_WEIGHT +
      v.viewCount +
      saves * SCORE_SAVE_WEIGHT +
      subscribers * SCORE_SUBSCRIBER_WEIGHT
    );
  }

  /** Paid course purchases across a teacher's live courses (same as profile subscriptionsCount). */
  private static async loadTeacherSubscriberCounts(
    teacherIds: string[]
  ): Promise<Map<string, number>> {
    if (teacherIds.length === 0) return new Map();

    const courses = await prisma.course.findMany({
      where: { teacherId: { in: teacherIds }, deletedAt: null },
      select: {
        teacherId: true,
        _count: { select: { purchases: { where: { status: "PAID" } } } },
      },
    });

    const counts = new Map<string, number>();
    for (const course of courses) {
      counts.set(
        course.teacherId,
        (counts.get(course.teacherId) ?? 0) + course._count.purchases
      );
    }
    return counts;
  }

  private static attachSubscriberCounts(
    videos: RawVideo[],
    counts: Map<string, number>
  ): RawVideo[] {
    return videos.map((v) => ({
      ...v,
      teacherSubscriberCount: counts.get(v.teacher.id) ?? 0,
    }));
  }

  private static sortFeed(videos: RawVideo[]) {
    const freshCutoff = Date.now() - FRESH_BOOST_MS;
    return [...videos].sort((a, b) => {
      const aFresh = a.createdAt.getTime() >= freshCutoff;
      const bFresh = b.createdAt.getTime() >= freshCutoff;
      if (aFresh && bFresh) return b.createdAt.getTime() - a.createdAt.getTime();
      if (aFresh !== bFresh) return aFresh ? -1 : 1;
      const scoreDiff = this.engagementScore(b) - this.engagementScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  static async listFeed(params: {
    userId?: string;
    cursor?: string;
    limit?: number;
    refresh?: boolean;
  }) {
    const limit = Math.min(params.limit ?? 12, 30);

    const videos = await prisma.teacherShortVideo.findMany({
      where: {
        ...PUBLIC_SHORT_VIDEO_WHERE,
        OR: [{ fileUrl: { not: null } }, { fileKey: { not: null } }],
      },
      include: this.videoInclude(params.userId),
    });

    const teacherIds = [...new Set(videos.map((v) => v.teacher.id))];
    const subscriberCounts = await this.loadTeacherSubscriberCounts(teacherIds);
    const enriched = this.attachSubscriberCounts(videos, subscriberCounts);
    const sorted = this.sortFeed(enriched);
    let start = 0;
    if (params.cursor && !params.refresh) {
      const idx = sorted.findIndex((v) => v.id === params.cursor);
      start = idx >= 0 ? idx + 1 : 0;
    }

    const page = sorted.slice(start, start + limit + 1);
    const hasMore = page.length > limit;
    const slice = hasMore ? page.slice(0, limit) : page;

    const mapped = (await Promise.all(slice.map((v) => this.mapVideo(v, params.userId)))).filter(
      (v) => v.fileUrl
    );

    return {
      videos: mapped,
      nextCursor: hasMore ? slice[slice.length - 1]?.id ?? null : null,
      refreshed: params.refresh === true,
    };
  }

  static async listSaved(userId: string) {
    const rows = await prisma.shortVideoSave.findMany({
      where: { userId, video: PUBLIC_SHORT_VIDEO_WHERE },
      orderBy: { createdAt: "desc" },
      include: {
        video: { include: this.videoInclude(userId) },
      },
    });

    const mapped = await Promise.all(
      rows.map((r) => this.mapVideo(r.video as RawVideo, userId))
    );
    return mapped.filter((v) => v.fileUrl);
  }

  static async toggleSave(videoId: string, userId: string) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, ...PUBLIC_SHORT_VIDEO_WHERE },
      select: {
        id: true,
        title: true,
        teacher: { select: { userId: true } },
      },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" as const };

    const existing = await prisma.shortVideoSave.findUnique({
      where: { videoId_userId: { videoId, userId } },
    });

    if (existing) {
      await prisma.shortVideoSave.delete({ where: { id: existing.id } });
    } else {
      await prisma.shortVideoSave.create({ data: { videoId, userId } });
    }

    const saves = await prisma.shortVideoSave.count({ where: { videoId } });
    return {
      success: true as const,
      savedByMe: !existing,
      saves,
      teacherUserId: video.teacher.userId,
      videoTitle: video.title,
    };
  }

  static async listForTeacher(teacherId: string, userId?: string) {
    const videos = await prisma.teacherShortVideo.findMany({
      where: { teacherId, ...PUBLIC_SHORT_VIDEO_WHERE },
      orderBy: { createdAt: "desc" },
      include: this.videoInclude(userId),
    });

    const mapped = await Promise.all(videos.map((v) => this.mapVideo(v, userId)));
    return mapped.filter((v) => v.fileUrl);
  }

  static async incrementView(videoId: string) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, ...PUBLIC_SHORT_VIDEO_WHERE },
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

  static async adminDelete(videoId: string) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, deletedAt: null },
      select: { id: true },
    });
    if (!video) return { success: false as const, error: "NOT_FOUND" as const };

    await prisma.teacherShortVideo.update({
      where: { id: videoId },
      data: { deletedAt: new Date() },
    });
    return { success: true as const };
  }

  static async listComments(videoId: string, limit = 50) {
    const video = await prisma.teacherShortVideo.findFirst({
      where: { id: videoId, ...PUBLIC_SHORT_VIDEO_WHERE },
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
      where: { id: params.videoId, ...PUBLIC_SHORT_VIDEO_WHERE },
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
