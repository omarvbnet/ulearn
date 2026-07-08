import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";

/** Student: favorited courses and favorited course videos, newest first. */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const userId = auth.session.userId;

  const [courseFavs, lessonFavs] = await Promise.all([
    prisma.courseFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { courseId: true },
    }),
    prisma.courseLessonFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { lessonId: true },
    }),
  ]);

  const courseIds = courseFavs.map((f) => f.courseId);
  const lessonIds = lessonFavs.map((f) => f.lessonId);

  const [courses, lessons, lessonLikeGroups, myLessonLikes] = await Promise.all([
    prisma.course.findMany({
      where: { id: { in: courseIds }, status: "APPROVED", deletedAt: null },
      include: {
        teacher: {
          select: { id: true, level: true, user: { select: { fullLegalName: true } } },
        },
        stage: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
        subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
        lessons: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, title: true, durationSec: true, isFreePreview: true },
        },
        _count: { select: { purchases: { where: { status: "PAID" } } } },
      },
    }),
    prisma.courseLesson.findMany({
      where: { id: { in: lessonIds }, course: { status: "APPROVED", deletedAt: null } },
      select: {
        id: true,
        title: true,
        durationSec: true,
        isFreePreview: true,
        courseId: true,
        course: {
          select: {
            id: true,
            titleEn: true,
            titleAr: true,
            titleKu: true,
            titleTr: true,
            thumbnail: true,
            price: true,
            currency: true,
            teacher: { select: { user: { select: { fullLegalName: true } } } },
          },
        },
      },
    }),
    prisma.courseLessonLike.groupBy({
      by: ["lessonId"],
      where: { lessonId: { in: lessonIds } },
      _count: true,
    }),
    prisma.courseLessonLike.findMany({
      where: { userId, lessonId: { in: lessonIds } },
      select: { lessonId: true },
    }),
  ]);

  // Preserve the favorites ordering (newest bookmark first).
  const courseOrder = new Map(courseIds.map((id, i) => [id, i]));
  const lessonOrder = new Map(lessonIds.map((id, i) => [id, i]));
  const enriched = await TeacherCourseService.enrichCoursesForUser(
    courses.sort(
      (a, b) => (courseOrder.get(a.id) ?? 0) - (courseOrder.get(b.id) ?? 0)
    ),
    userId
  );

  const likeCounts = new Map(lessonLikeGroups.map((g) => [g.lessonId, g._count]));
  const likedSet = new Set(myLessonLikes.map((l) => l.lessonId));

  const lessonsOut = lessons
    .sort((a, b) => (lessonOrder.get(a.id) ?? 0) - (lessonOrder.get(b.id) ?? 0))
    .map((l) => ({
      ...l,
      likes: likeCounts.get(l.id) ?? 0,
      likedByMe: likedSet.has(l.id),
      favoritedByMe: true,
    }));

  return json({ courses: enriched, lessons: lessonsOut });
}
