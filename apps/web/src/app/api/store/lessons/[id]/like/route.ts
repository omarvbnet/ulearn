import { error, json, requireAuth, STORE_ENGAGEMENT_ROLES } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { PUBLIC_LESSON_WHERE } from "@/lib/video-visibility";
import { notifyTeacherVideoLike } from "@/services/engagement-notifications.service";
import { getCurrentUser } from "@/lib/auth/session";

/** Toggle a like on an individual course video. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(STORE_ENGAGEMENT_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const lesson = await prisma.courseLesson.findFirst({
    where: { id, ...PUBLIC_LESSON_WHERE, course: { status: "APPROVED", deletedAt: null } },
    select: {
      id: true,
      title: true,
      courseId: true,
      course: {
        select: { teacher: { select: { userId: true } } },
      },
    },
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
    const teacherUserId = lesson.course.teacher.userId;
    if (teacherUserId !== userId) {
      const liker = await getCurrentUser();
      await notifyTeacherVideoLike({
        teacherUserId,
        lessonTitle: lesson.title,
        likerName: liker?.fullLegalName ?? "Someone",
        courseId: lesson.courseId,
        lessonId: id,
      });
    }
  }

  const likes = await prisma.courseLessonLike.count({ where: { lessonId: id } });
  return json({ likes, likedByMe: !existing });
}
