import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { PUBLIC_SHORT_VIDEO_WHERE } from "@/lib/video-visibility";
import { notifyTeacherShortVideoLike } from "@/services/engagement-notifications.service";
import { getCurrentUser } from "@/lib/auth/session";

/** Toggle a like on a teacher short video. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER", "TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const video = await prisma.teacherShortVideo.findFirst({
    where: { id, ...PUBLIC_SHORT_VIDEO_WHERE },
    select: {
      id: true,
      title: true,
      teacher: { select: { userId: true } },
    },
  });
  if (!video) return error("Video not found", 404, "NOT_FOUND");

  const userId = auth.session.userId;
  const existing = await prisma.shortVideoLike.findUnique({
    where: { videoId_userId: { videoId: id, userId } },
  });

  if (existing) {
    await prisma.shortVideoLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.shortVideoLike.create({ data: { videoId: id, userId } });
    const teacherUserId = video.teacher.userId;
    if (teacherUserId !== userId) {
      const liker = await getCurrentUser();
      await notifyTeacherShortVideoLike({
        teacherUserId,
        videoTitle: video.title,
        likerName: liker?.fullLegalName ?? "Someone",
      });
    }
  }

  const likes = await prisma.shortVideoLike.count({ where: { videoId: id } });
  return json({ likes, likedByMe: !existing });
}
