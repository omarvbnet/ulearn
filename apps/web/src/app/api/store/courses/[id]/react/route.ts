import { error, json, requireAuth, STORE_ENGAGEMENT_ROLES } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { notifyTeacherCourseLike } from "@/services/engagement-notifications.service";
import { getCurrentUser } from "@/lib/auth/session";
import { z } from "zod";

const schema = z.object({ type: z.enum(["LIKE", "DISLIKE"]).nullable() });

/** Like/dislike a store course. Teachers may react too. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(STORE_ENGAGEMENT_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const course = await prisma.course.findFirst({
    where: { id, status: "APPROVED", deletedAt: null },
    select: {
      id: true,
      titleEn: true,
      teacher: { select: { userId: true } },
    },
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const userId = auth.session.userId;
  const type = parsed.data.type;
  const existing = await prisma.courseReaction.findUnique({
    where: { courseId_userId: { courseId: id, userId } },
  });

  let myReaction: "LIKE" | "DISLIKE" | null = null;
  if (type === null || existing?.type === type) {
    if (existing) await prisma.courseReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.courseReaction.upsert({
      where: { courseId_userId: { courseId: id, userId } },
      create: { courseId: id, userId, type },
      update: { type },
    });
    myReaction = type;
    if (type === "LIKE" && course.teacher.userId !== userId) {
      const liker = await getCurrentUser();
      await notifyTeacherCourseLike({
        teacherUserId: course.teacher.userId,
        courseTitle: course.titleEn,
        likerName: liker?.fullLegalName ?? "Someone",
        courseId: id,
      });
    }
  }

  const groups = await prisma.courseReaction.groupBy({
    by: ["type"],
    where: { courseId: id },
    _count: true,
  });
  const likes = groups.find((g) => g.type === "LIKE")?._count ?? 0;
  const dislikes = groups.find((g) => g.type === "DISLIKE")?._count ?? 0;

  return json({ likes, dislikes, myReaction });
}
