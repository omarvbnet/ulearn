import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Toggle a like on an individual course video. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const lesson = await prisma.courseLesson.findFirst({
    where: { id, course: { status: "APPROVED", deletedAt: null } },
    select: { id: true },
  });
  if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");

  const userId = auth.session.userId;
  const existing = await prisma.courseLessonLike.findUnique({
    where: { lessonId_userId: { lessonId: id, userId } },
  });

  if (existing) {
    await prisma.courseLessonLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.courseLessonLike.create({ data: { lessonId: id, userId } });
  }

  const likes = await prisma.courseLessonLike.count({ where: { lessonId: id } });
  return json({ likes, likedByMe: !existing });
}
