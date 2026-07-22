import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Students rate a teacher (1–5 stars, optional comment). Upserts per student. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const { id: teacherId } = await params;
  const { rating, comment } = (await request.json()) as {
    rating?: number;
    comment?: string;
  };

  if (!rating || rating < 1 || rating > 5) {
    return error("rating must be between 1 and 5", 422, "VALIDATION");
  }

  const teacher = await prisma.teacherProfile.findFirst({
    where: { id: teacherId, deletedAt: null },
  });
  if (!teacher) return error("Teacher not found", 404, "NOT_FOUND");

  const saved = await prisma.teacherRating.upsert({
    where: { teacherId_userId: { teacherId, userId: auth.session.userId } },
    update: { rating, comment: comment || null },
    create: { teacherId, userId: auth.session.userId, rating, comment: comment || null },
  });

  // Student evaluations drive the teacher level (unless pinned by an admin).
  const { TeacherCourseService } = await import("@/services/teacher-course.service");
  await TeacherCourseService.recomputeLevel(teacherId).catch(() => {});

  return json({ rating: saved }, 201);
}

/** Public rating summary for a teacher. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id: teacherId } = await params;
  const [agg, recent] = await Promise.all([
    prisma.teacherRating.aggregate({
      where: { teacherId },
      _avg: { rating: true },
      _count: true,
    }),
    prisma.teacherRating.findMany({
      where: { teacherId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { rating: true, comment: true, createdAt: true },
    }),
  ]);

  return json({ average: agg._avg.rating ?? 0, count: agg._count, recent });
}
