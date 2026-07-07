import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { STAFF_ROLES } from "@/lib/auth/session";

export async function GET() {
  const auth = await requireAuth(STAFF_ROLES);
  if (auth.error) return auth.error;

  // Teachers see students in their assigned subjects; admins see all.
  const profile = await prisma.teacherProfile.findUnique({
    where: { userId: auth.session.userId },
    include: { subjects: true },
  });
  const subjectIds = profile?.subjects.map((s) => s.subjectId) ?? [];

  const students = await prisma.user.findMany({
    where: {
      role: { in: ["STUDENT", "CERTIFICATE_USER"] },
      status: "APPROVED",
      deletedAt: null,
      ...(subjectIds.length > 0
        ? {
            subscriptions: {
              some: { status: "ACTIVE", package: { subjectId: { in: subjectIds } } },
            },
          }
        : profile
          ? { countryId: profile.countryId ?? undefined }
          : {}),
    },
    take: 200,
    orderBy: { lastActivityAt: "desc" },
    select: {
      id: true,
      fullLegalName: true,
      phone: true,
      role: true,
      lastActivityAt: true,
      country: { select: { nameEn: true } },
      province: { select: { nameEn: true } },
    },
  });

  const ids = students.map((s) => s.id);
  const [progressAgg, quizAgg] = await Promise.all([
    prisma.videoProgress.groupBy({
      by: ["userId"],
      where: { userId: { in: ids } },
      _sum: { totalWatchSec: true },
      _count: { _all: true },
    }),
    prisma.quizAttempt.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, completedAt: { not: null } },
      _avg: { percentage: true },
    }),
  ]);

  const watchOf = new Map(progressAgg.map((p) => [p.userId, p._sum.totalWatchSec ?? 0]));
  const quizOf = new Map(quizAgg.map((q) => [q.userId, q._avg.percentage ?? 0]));

  return json({
    students: students.map((s) => ({
      ...s,
      watchSec: watchOf.get(s.id) ?? 0,
      avgQuizScore: quizOf.get(s.id) ?? null,
    })),
  });
}
