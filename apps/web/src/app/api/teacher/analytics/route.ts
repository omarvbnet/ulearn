import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { STAFF_ROLES } from "@/lib/auth/session";
import { AnalyticsService } from "@/services/analytics.service";

export async function GET() {
  const auth = await requireAuth(STAFF_ROLES);
  if (auth.error) return auth.error;

  const profile = await prisma.teacherProfile.findUnique({
    where: { userId: auth.session.userId },
  });

  const stats = profile ? await AnalyticsService.getTeacherStats(profile.id) : null;

  const [openQuestions, answeredByMe] = await Promise.all([
    prisma.lessonQuestion.count({ where: { isResolved: false, deletedAt: null } }),
    prisma.lessonAnswer.count({ where: { teacherId: auth.session.userId } }),
  ]);

  return json({
    stats: stats ?? { studentCount: 0, courseCount: 0, complaintCount: 0, avgRating: 0, ratings: [] },
    openQuestions,
    answeredByMe,
  });
}
