import { error, json, optionalAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { PUBLIC_LESSON_WHERE } from "@/lib/video-visibility";
import { CourseRatingService } from "@/services/course-rating.service";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { VideoService } from "@/services/video.service";
import { getDownloadUrl } from "@/lib/r2";
import type { Locale } from "@prisma/client";

/** Course detail — public browse; purchase/progress fields when signed in. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await optionalAuth();
  const userId = session?.userId;

  const { id } = await params;
  const course = await prisma.course.findFirst({
    where: { id, status: "APPROVED", deletedAt: null },
    include: {
      teacher: {
        select: { id: true, level: true, userId: true, user: { select: { fullLegalName: true } } },
      },
      stage: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
      subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
      lessons: { orderBy: { sortOrder: "asc" }, where: PUBLIC_LESSON_WHERE },
    },
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const quizzes = await prisma.quiz.findMany({
    where: { courseId: id, deletedAt: null, isActive: true },
    orderBy: [{ afterLessonId: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      titleEn: true,
      titleAr: true,
      titleKu: true,
      titleTr: true,
      passPercentage: true,
      maxAttempts: true,
      afterLessonId: true,
      _count: { select: { questions: true } },
    },
  });

  const lessonIds = course.lessons.map((l) => l.id);
  const [purchased, myFavorite, favoriteCount, likeGroups, myLikes, favGroups, myLessonFavs] =
    await Promise.all([
      userId ? TeacherCourseService.hasPurchased(id, userId) : Promise.resolve(false),
      userId
        ? prisma.courseFavorite.findUnique({
            where: { courseId_userId: { courseId: id, userId } },
          })
        : Promise.resolve(null),
      prisma.courseFavorite.count({ where: { courseId: id } }),
      prisma.courseLessonLike.groupBy({
        by: ["lessonId"],
        where: { lessonId: { in: lessonIds } },
        _count: true,
      }),
      userId
        ? prisma.courseLessonLike.findMany({
            where: { userId, lessonId: { in: lessonIds } },
            select: { lessonId: true },
          })
        : Promise.resolve([] as { lessonId: string }[]),
      prisma.courseLessonFavorite.groupBy({
        by: ["lessonId"],
        where: { lessonId: { in: lessonIds } },
        _count: true,
      }),
      userId
        ? prisma.courseLessonFavorite.findMany({
            where: { userId, lessonId: { in: lessonIds } },
            select: { lessonId: true },
          })
        : Promise.resolve([] as { lessonId: string }[]),
    ]);

  const likeCounts = new Map(likeGroups.map((g) => [g.lessonId, g._count]));
  const likedSet = new Set(myLikes.map((l) => l.lessonId));
  const favCounts = new Map(favGroups.map((g) => [g.lessonId, g._count]));
  const favSet = new Set(myLessonFavs.map((f) => f.lessonId));

  const isOwnCourse = Boolean(userId && course.teacher.userId === userId);
  const hasAccess = purchased || isOwnCourse || course.price <= 0;

  const progressRows = userId
    ? await prisma.courseLessonProgress.findMany({
        where: { userId, lessonId: { in: lessonIds } },
        select: {
          lessonId: true,
          isCompleted: true,
          completionPct: true,
          positionSec: true,
        },
      })
    : [];
  const progressMap = new Map(progressRows.map((p) => [p.lessonId, p]));

  const quizIds = quizzes.map((q) => q.id);
  const passedAttempts =
    userId && quizIds.length > 0
      ? await prisma.quizAttempt.findMany({
          where: {
            userId,
            quizId: { in: quizIds },
            passed: true,
            completedAt: { not: null },
          },
          select: { quizId: true },
          distinct: ["quizId"],
        })
      : [];
  const passedQuizIds = new Set(passedAttempts.map((a) => a.quizId));

  const durationBackfill = lessonIds.length
    ? await prisma.courseLessonProgress.groupBy({
        by: ["lessonId"],
        where: { lessonId: { in: lessonIds }, durationSec: { gt: 0 } },
        _max: { durationSec: true },
      })
    : [];
  const watchedDuration = new Map(
    durationBackfill.map((g) => [g.lessonId, g._max.durationSec ?? 0])
  );

  const lessons = await Promise.all(
    course.lessons.map(async (l) => {
      const freePreviewSec =
        !l.isFreePreview && typeof l.freePreviewSec === "number" && l.freePreviewSec > 0
          ? l.freePreviewSec
          : null;
      const canWatch = hasAccess || l.isFreePreview || freePreviewSec != null;
      const previewOnly = !hasAccess && !l.isFreePreview && freePreviewSec != null;
      let fileUrl = canWatch ? l.fileUrl : null;
      if (canWatch && l.fileKey && !fileUrl) {
        fileUrl = await getDownloadUrl(l.fileKey).catch(() => null);
      }
      let thumbnailUrl = l.thumbnailUrl;
      if (!thumbnailUrl && l.thumbnailKey) {
        thumbnailUrl = await getDownloadUrl(l.thumbnailKey).catch(() => null);
      }
      const durationSec = l.durationSec ?? watchedDuration.get(l.id) ?? null;
      return {
        ...l,
        durationSec,
        freePreviewSec,
        previewOnly,
        fileKey: undefined,
        thumbnailKey: undefined,
        fileUrl,
        thumbnailUrl,
        canWatch,
        likes: likeCounts.get(l.id) ?? 0,
        likedByMe: likedSet.has(l.id),
        favoritesCount: favCounts.get(l.id) ?? 0,
        favoritedByMe: favSet.has(l.id),
        isCompleted: progressMap.get(l.id)?.isCompleted ?? false,
        progressPct: progressMap.get(l.id)?.completionPct ?? 0,
        watchPositionSec: progressMap.get(l.id)?.positionSec ?? 0,
      };
    })
  );

  const totalDurationSec = lessons.reduce(
    (sum, l) => sum + ((l.durationSec as number | null) ?? 0),
    0
  );

  const subscribersCount = await prisma.coursePurchase.count({
    where: { courseId: id, status: "PAID" },
  });

  const materialRows = hasAccess
    ? await prisma.courseMaterial.findMany({
        where: { courseId: id, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          type: true,
          fileKey: true,
          fileUrl: true,
          fileSize: true,
          mimeType: true,
          lessonId: true,
          sortOrder: true,
          createdAt: true,
        },
      })
    : [];

  const materials = await Promise.all(
    materialRows.map(async (m) => {
      let fileUrl = m.fileUrl;
      if (m.fileKey && !fileUrl) {
        fileUrl = await getDownloadUrl(m.fileKey).catch(() => null);
      }
      return {
        id: m.id,
        title: m.title,
        type: m.type,
        fileUrl,
        fileSize: m.fileSize,
        mimeType: m.mimeType,
        lessonId: m.lessonId,
        sortOrder: m.sortOrder,
        createdAt: m.createdAt,
      };
    })
  );

  const completion = userId
    ? await CourseRatingService.getCompletionStatus(id, userId)
    : null;
  const quizzesWithStatus = quizzes.map((q) => ({
    ...q,
    passedByMe: passedQuizIds.has(q.id),
  }));

  const purchaseRow = userId
    ? await prisma.coursePurchase.findUnique({
        where: { courseId_userId: { courseId: id, userId } },
        select: { status: true, expiresAt: true },
      })
    : null;

  const user = userId ? await getCurrentUser() : null;
  const locale = (user?.locale ?? "AR") as Locale;
  const introOutro = await VideoService.getPlayableIntroOutro(
    locale,
    user?.countryId ?? undefined
  );

  return json({
    course: {
      ...course,
      lessons,
      materials,
      totalDurationSec,
      lessonsCount: lessons.length,
      subscribersCount,
      courseRating: completion?.courseRating ?? null,
      courseRatingCount: completion?.courseRatingCount ?? 0,
      accessMonths: course.accessMonths,
      appleProductId: course.appleProductId,
      googleProductId: course.googleProductId,
    },
    quizzes: quizzesWithStatus,
    completion,
    purchased,
    purchaseExpiresAt: purchased ? purchaseRow?.expiresAt ?? null : null,
    isOwnCourse,
    favorites: favoriteCount,
    favoritedByMe: Boolean(myFavorite),
    introOutro,
  });
}
