import { prisma } from "@/lib/prisma";
import { computeVideoCompletion } from "@/lib/video-progress.util";
import { getDownloadUrl, mediaProxyPath } from "@/lib/r2";
import { CourseService } from "@/services/course.service";

export class VideoService {
  static async updateProgress(params: {
    userId: string;
    lessonId: string;
    positionSec: number;
    durationSec: number;
    watchedDeltaSec?: number;
    completed?: boolean;
  }) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: params.lessonId },
      include: { chapter: { include: { subject: true } } },
    });
    if (!lesson) return { success: false as const, error: "LESSON_NOT_FOUND" };

    const hasAccess =
      lesson.isFree ||
      (await CourseService.userHasSubjectAccess(
        params.userId,
        lesson.chapter.subjectId,
        lesson.chapter.subject.stageId
      ));

    if (!hasAccess) {
      return { success: false as const, error: "NO_ACCESS" };
    }

    const existing = await prisma.videoProgress.findUnique({
      where: {
        userId_lessonId: { userId: params.userId, lessonId: params.lessonId },
      },
    });

    let { completionPct, isCompleted, positionSec } = computeVideoCompletion({
      positionSec: params.positionSec,
      durationSec: params.durationSec,
      completed: params.completed,
    });

    if (existing?.isCompleted) {
      isCompleted = true;
      completionPct = 100;
      if (params.durationSec > 0) {
        positionSec = Math.max(existing.positionSec, params.durationSec);
      } else {
        positionSec = Math.max(existing.positionSec, positionSec);
      }
    }

    const progress = await prisma.videoProgress.upsert({
      where: {
        userId_lessonId: { userId: params.userId, lessonId: params.lessonId },
      },
      create: {
        userId: params.userId,
        lessonId: params.lessonId,
        positionSec,
        durationSec: params.durationSec,
        completionPct,
        isCompleted,
        totalWatchSec: params.watchedDeltaSec ?? 0,
        lastWatchedAt: new Date(),
      },
      update: {
        positionSec,
        durationSec: params.durationSec,
        completionPct,
        isCompleted,
        totalWatchSec: { increment: params.watchedDeltaSec ?? 0 },
        lastWatchedAt: new Date(),
      },
    });

    await prisma.user.update({
      where: { id: params.userId },
      data: { lastActivityAt: new Date() },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.dailyActivity.upsert({
      where: { userId_date: { userId: params.userId, date: today } },
      create: {
        userId: params.userId,
        date: today,
        watchTimeSec: params.watchedDeltaSec ?? 0,
        lessonsDone: isCompleted ? 1 : 0,
      },
      update: {
        watchTimeSec: { increment: params.watchedDeltaSec ?? 0 },
        ...(isCompleted ? { lessonsDone: { increment: 1 } } : {}),
      },
    });

    return { success: true as const, progress };
  }

  static async getResumePosition(userId: string, lessonId: string) {
    const progress = await prisma.videoProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
    return progress?.positionSec ?? 0;
  }

  static async getContinueWatching(userId: string, limit = 10) {
    return prisma.videoProgress.findMany({
      where: { userId, isCompleted: false, completionPct: { gt: 0 } },
      orderBy: { lastWatchedAt: "desc" },
      take: limit,
      include: {
        lesson: {
          include: {
            chapter: { include: { subject: true } },
            contents: { where: { type: "VIDEO" }, take: 1 },
          },
        },
      },
    });
  }

  static async getIntroOutro(locale: "AR" | "KU" | "TR" | "EN", countryId?: string) {
    const intro = await prisma.introOutro.findFirst({
      where: {
        locale,
        type: "INTRO",
        isActive: true,
        OR: [{ countryId: countryId ?? null }, { countryId: null }],
      },
      orderBy: { countryId: "desc" },
    });

    const outro = await prisma.introOutro.findFirst({
      where: {
        locale,
        type: "OUTRO",
        isActive: true,
        OR: [{ countryId: countryId ?? null }, { countryId: null }],
      },
      orderBy: { countryId: "desc" },
    });

    return { intro, outro };
  }

  /** Intro/outro clips with short-lived signed playback URLs for clients. */
  static async getPlayableIntroOutro(
    locale: "AR" | "KU" | "TR" | "EN",
    countryId?: string
  ) {
    const sign = async (
      clip: Awaited<ReturnType<typeof VideoService.getIntroOutro>>["intro"]
    ) => {
      if (!clip) return null;
      let fileUrl: string | null = null;
      if (clip.fileKey) {
        fileUrl = await getDownloadUrl(clip.fileKey, 3 * 3600).catch(() => null);
      }
      // Prefer proxy path over stale absolute URLs so mobile can resolve against API origin.
      if (!fileUrl) {
        const raw = clip.fileUrl?.trim() || "";
        if (raw.startsWith("/api/media/") || raw.startsWith("/uploads/")) {
          fileUrl = raw;
        } else if (raw.startsWith("http://") || raw.startsWith("https://")) {
          fileUrl = raw;
        } else if (clip.fileKey) {
          fileUrl = mediaProxyPath(clip.fileKey);
        }
      }
      if (!fileUrl) return null;
      return {
        id: clip.id,
        type: clip.type,
        locale: clip.locale,
        fileUrl,
      };
    };

    // Prefer the user's locale, then fall back so KU/TR (etc.) still get clips.
    const tryLocales: Array<"AR" | "KU" | "TR" | "EN"> = [
      locale,
      "AR",
      "EN",
      "KU",
      "TR",
    ];
    const seen = new Set<string>();
    for (const loc of tryLocales) {
      if (seen.has(loc)) continue;
      seen.add(loc);
      const pair = await this.getIntroOutro(loc, countryId);
      if (pair.intro || pair.outro) {
        return {
          intro: await sign(pair.intro),
          outro: await sign(pair.outro),
        };
      }
    }

    // Last resort: any active intro/outro regardless of locale.
    const anyIntro = await prisma.introOutro.findFirst({
      where: { type: "INTRO", isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    const anyOutro = await prisma.introOutro.findFirst({
      where: { type: "OUTRO", isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    return {
      intro: await sign(anyIntro),
      outro: await sign(anyOutro),
    };
  }
}
