import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Toggle a course bookmark (shown in the student's profile favorites). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await prisma.course.findFirst({
    where: { id, status: "APPROVED", deletedAt: null },
    select: { id: true },
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const userId = auth.session.userId;
  const existing = await prisma.courseFavorite.findUnique({
    where: { courseId_userId: { courseId: id, userId } },
  });

  if (existing) {
    await prisma.courseFavorite.delete({ where: { id: existing.id } });
  } else {
    await prisma.courseFavorite.create({ data: { courseId: id, userId } });
  }

  const favorites = await prisma.courseFavorite.count({ where: { courseId: id } });
  return json({ favorites, favoritedByMe: !existing });
}
