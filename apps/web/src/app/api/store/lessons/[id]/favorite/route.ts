import { error, json, requireAuth, STORE_ENGAGEMENT_ROLES } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Toggle a bookmark on an individual course video (shown in profile favorites). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(STORE_ENGAGEMENT_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const lesson = await prisma.courseLesson.findFirst({
    where: { id, course: { status: "APPROVED", deletedAt: null } },
    select: { id: true },
  });
  if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");

  const userId = auth.session.userId;
  const existing = await prisma.courseLessonFavorite.findUnique({
    where: { lessonId_userId: { lessonId: id, userId } },
  });

  if (existing) {
    await prisma.courseLessonFavorite.delete({ where: { id: existing.id } });
  } else {
    await prisma.courseLessonFavorite.create({ data: { lessonId: id, userId } });
  }

  const favorites = await prisma.courseLessonFavorite.count({ where: { lessonId: id } });
  return json({ favorites, favoritedByMe: !existing });
}
