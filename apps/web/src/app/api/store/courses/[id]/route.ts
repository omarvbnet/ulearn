import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { getDownloadUrl } from "@/lib/r2";

/** Students: course detail; lesson media only after a confirmed purchase. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const userId = auth.session.userId;

  const { id } = await params;
  const course = await prisma.course.findFirst({
    where: { id, status: "APPROVED", deletedAt: null },
    include: {
      teacher: {
        select: { id: true, level: true, userId: true, user: { select: { fullLegalName: true } } },
      },
      stage: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
      subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
      lessons: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const quizzes = await prisma.quiz.findMany({
    where: { courseId: id, deletedAt: null, isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      titleEn: true,
      titleAr: true,
      titleKu: true,
      titleTr: true,
      passPercentage: true,
      maxAttempts: true,
      _count: { select: { questions: true } },
    },
  });

  const lessonIds = course.lessons.map((l) => l.id);
  const [purchased, myFavorite, favoriteCount, likeGroups, myLikes, favGroups, myLessonFavs] =
    await Promise.all([
      TeacherCourseService.hasPurchased(id, userId),
      prisma.courseFavorite.findUnique({
        where: { courseId_userId: { courseId: id, userId } },
      }),
      prisma.courseFavorite.count({ where: { courseId: id } }),
      prisma.courseLessonLike.groupBy({
        by: ["lessonId"],
        where: { lessonId: { in: lessonIds } },
        _count: true,
      }),
      prisma.courseLessonLike.findMany({
        where: { userId, lessonId: { in: lessonIds } },
        select: { lessonId: true },
      }),
      prisma.courseLessonFavorite.groupBy({
        by: ["lessonId"],
        where: { lessonId: { in: lessonIds } },
        _count: true,
      }),
      prisma.courseLessonFavorite.findMany({
        where: { userId, lessonId: { in: lessonIds } },
        select: { lessonId: true },
      }),
    ]);

  const likeCounts = new Map(likeGroups.map((g) => [g.lessonId, g._count]));
  const likedSet = new Set(myLikes.map((l) => l.lessonId));
  const favCounts = new Map(favGroups.map((g) => [g.lessonId, g._count]));
  const favSet = new Set(myLessonFavs.map((f) => f.lessonId));

  const isOwnCourse = course.teacher.userId === userId;
  const hasAccess = purchased || isOwnCourse || course.price <= 0;

  const progressRows = await prisma.courseLessonProgress.findMany({
    where: { userId, lessonId: { in: lessonIds } },
    select: {
      lessonId: true,
      isCompleted: true,
      completionPct: true,
      positionSec: true,
    },
  });
  const progressMap = new Map(progressRows.map((p) => [p.lessonId, p]));

  const lessons = await Promise.all(
    course.lessons.map(async (l) => {
      const canWatch = hasAccess || l.isFreePreview;
      let fileUrl = canWatch ? l.fileUrl : null;
      if (canWatch && l.fileKey && !fileUrl) {
        fileUrl = await getDownloadUrl(l.fileKey).catch(() => null);
      }
      // Covers are shown for every lesson (locked ones included).
      let thumbnailUrl = l.thumbnailUrl;
      if (!thumbnailUrl && l.thumbnailKey) {
        thumbnailUrl = await getDownloadUrl(l.thumbnailKey).catch(() => null);
      }
      return {
        ...l,
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

  return json({
    course: { ...course, lessons },
    quizzes,
    purchased,
    isOwnCourse,
    favorites: favoriteCount,
    favoritedByMe: Boolean(myFavorite),
  });
}
