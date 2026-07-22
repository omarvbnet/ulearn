import { prisma } from "@/lib/prisma";

export class AnalyticsService {
  static async getDashboardStats(countryId?: string) {
    const userWhere = {
      deletedAt: null,
      ...(countryId ? { countryId } : {}),
    };

    const [
      totalUsers,
      totalStudents,
      certificateUsers,
      maleCount,
      femaleCount,
      activeUsers,
      inactiveUsers,
      pendingUsers,
      activeSubscriptions,
      pendingRequests,
    ] = await Promise.all([
      prisma.user.count({ where: userWhere }),
      prisma.user.count({ where: { ...userWhere, role: "STUDENT" } }),
      prisma.user.count({ where: { ...userWhere, role: "CERTIFICATE_USER" } }),
      prisma.user.count({ where: { ...userWhere, gender: "MALE" } }),
      prisma.user.count({ where: { ...userWhere, gender: "FEMALE" } }),
      prisma.user.count({ where: { ...userWhere, status: "APPROVED" } }),
      prisma.user.count({ where: { ...userWhere, status: "INACTIVE" } }),
      prisma.user.count({ where: { ...userWhere, status: "PENDING" } }),
      prisma.subscription.count({
        where: {
          status: "ACTIVE",
          ...(countryId ? { package: { countryId } } : {}),
        },
      }),
      prisma.activationRequest.count({
        where: {
          status: "PENDING",
          ...(countryId ? { package: { countryId } } : {}),
        },
      }),
    ]);

    const byProvince = await prisma.user.groupBy({
      by: ["provinceId"],
      where: userWhere,
      _count: true,
    });

    const provinces = await prisma.province.findMany({
      where: countryId ? { countryId } : undefined,
    });

    const provinceStats = byProvince.map((p) => ({
      provinceId: p.provinceId,
      name: provinces.find((x) => x.id === p.provinceId)?.nameEn ?? "Unknown",
      count: p._count,
    }));

    const byCountry = countryId
      ? []
      : await prisma.user.groupBy({
          by: ["countryId"],
          where: { deletedAt: null },
          _count: true,
        });

    const registrationTrends = await this.getRegistrationTrends(30, countryId);
    const revenue = await this.getRevenueStats(countryId);
    const completion = await this.getCompletionStats(countryId);

    return {
      totalUsers,
      totalStudents,
      certificateUsers,
      maleCount,
      femaleCount,
      activeUsers,
      inactiveUsers,
      pendingUsers,
      activeSubscriptions,
      pendingRequests,
      provinceStats,
      byCountry,
      registrationTrends,
      revenue,
      completion,
    };
  }

  static async getRegistrationTrends(days: number, countryId?: string) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const users = await prisma.user.findMany({
      where: {
        createdAt: { gte: since },
        deletedAt: null,
        ...(countryId ? { countryId } : {}),
      },
      select: { createdAt: true },
    });

    const map = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      map.set(d.toISOString().slice(0, 10), 0);
    }

    for (const u of users) {
      const key = u.createdAt.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }

    return Array.from(map.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  static async getRevenueStats(countryId?: string) {
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ["ACTIVE", "EXPIRED"] },
        ...(countryId ? { package: { countryId } } : {}),
      },
      include: { package: true },
    });

    const total = subscriptions.reduce(
      (sum, s) => sum + Number(s.package.price),
      0
    );

    return { totalRevenue: total, subscriptionCount: subscriptions.length };
  }

  static async getCompletionStats(countryId?: string) {
    const progress = await prisma.videoProgress.groupBy({
      by: ["isCompleted"],
      where: countryId
        ? { lesson: { chapter: { subject: { countryId } } } }
        : undefined,
      _count: true,
    });

    const completed = progress.find((p) => p.isCompleted)?._count ?? 0;
    const incomplete = progress.find((p) => !p.isCompleted)?._count ?? 0;
    const total = completed + incomplete;

    return {
      completed,
      incomplete,
      completionRate: total > 0 ? (completed / total) * 100 : 0,
    };
  }

  static async getStudentAnalytics(userId: string) {
    const [progress, quizStats, watchTime, daily] = await Promise.all([
      prisma.videoProgress.findMany({
        where: { userId },
        include: { lesson: { include: { chapter: { include: { subject: true } } } } },
      }),
      prisma.quizAttempt.findMany({
        where: { userId, completedAt: { not: null } },
        include: { quiz: true },
      }),
      prisma.videoProgress.aggregate({
        where: { userId },
        _sum: { totalWatchSec: true },
      }),
      prisma.dailyActivity.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 30,
      }),
    ]);

    const completedLessons = progress.filter((p) => p.isCompleted).length;
    const totalLessons = progress.length;
    const hoursWatched = (watchTime._sum.totalWatchSec ?? 0) / 3600;

    const quizBySubject = new Map<string, { scores: number[]; name: string }>();
    for (const a of quizStats) {
      const key = a.quiz.subjectId ?? a.quiz.chapterId ?? a.quiz.lessonId ?? "general";
      const entry = quizBySubject.get(key) ?? { scores: [], name: a.quiz.titleEn };
      entry.scores.push(a.percentage);
      quizBySubject.set(key, entry);
    }

    const strengths: string[] = [];
    const weaknesses: string[] = [];

    for (const [, data] of quizBySubject) {
      const avg = data.scores.reduce((s, n) => s + n, 0) / data.scores.length;
      if (avg >= 70) strengths.push(data.name);
      else weaknesses.push(data.name);
    }

    return {
      completedLessons,
      totalLessons,
      completionPct: totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0,
      hoursWatched,
      quizAverage:
        quizStats.length > 0
          ? quizStats.reduce((s, a) => s + a.percentage, 0) / quizStats.length
          : 0,
      strengths,
      weaknesses,
      dailyActivity: daily,
    };
  }

  static async getRankings(countryId?: string, limit = 20) {
    const userFilter = {
      deletedAt: null,
      status: "APPROVED" as const,
      ...(countryId ? { countryId } : {}),
    };

    const students = await prisma.user.findMany({
      where: { ...userFilter, role: "STUDENT" },
      select: { id: true, fullLegalName: true },
    });

    const certUsers = await prisma.user.findMany({
      where: { ...userFilter, role: "CERTIFICATE_USER" },
      select: { id: true, fullLegalName: true },
    });

    const studentIds = students.map((s) => s.id);
    const certIds = certUsers.map((s) => s.id);

    const [watchAgg, quizAgg, activityAgg] = await Promise.all([
      prisma.videoProgress.groupBy({
        by: ["userId"],
        where: { userId: { in: [...studentIds, ...certIds] } },
        _sum: { totalWatchSec: true },
        _count: { isCompleted: true },
      }),
      prisma.quizAttempt.groupBy({
        by: ["userId"],
        where: { userId: { in: [...studentIds, ...certIds] }, completedAt: { not: null } },
        _avg: { percentage: true },
      }),
      prisma.dailyActivity.groupBy({
        by: ["userId"],
        where: { userId: { in: [...studentIds, ...certIds] } },
        _sum: { watchTimeSec: true, lessonsDone: true },
      }),
    ]);

    const nameOf = (id: string) =>
      students.find((s) => s.id === id)?.fullLegalName ||
      certUsers.find((s) => s.id === id)?.fullLegalName ||
      "User";

    const topStudents = watchAgg
      .filter((w) => studentIds.includes(w.userId))
      .sort((a, b) => (b._sum.totalWatchSec ?? 0) - (a._sum.totalWatchSec ?? 0))
      .slice(0, limit)
      .map((w, i) => ({
        rank: i + 1,
        userId: w.userId,
        name: nameOf(w.userId),
        watchSec: w._sum.totalWatchSec ?? 0,
      }));

    const topCertificateUsers = watchAgg
      .filter((w) => certIds.includes(w.userId))
      .sort((a, b) => (b._sum.totalWatchSec ?? 0) - (a._sum.totalWatchSec ?? 0))
      .slice(0, limit)
      .map((w, i) => ({
        rank: i + 1,
        userId: w.userId,
        name: nameOf(w.userId),
        watchSec: w._sum.totalWatchSec ?? 0,
      }));

    const highestScores = quizAgg
      .sort((a, b) => (b._avg.percentage ?? 0) - (a._avg.percentage ?? 0))
      .slice(0, limit)
      .map((q, i) => ({
        rank: i + 1,
        userId: q.userId,
        name: nameOf(q.userId),
        avgScore: q._avg.percentage ?? 0,
      }));

    const mostActive = activityAgg
      .sort(
        (a, b) =>
          (b._sum.watchTimeSec ?? 0) + (b._sum.lessonsDone ?? 0) * 100 -
          ((a._sum.watchTimeSec ?? 0) + (a._sum.lessonsDone ?? 0) * 100)
      )
      .slice(0, limit)
      .map((a, i) => ({
        rank: i + 1,
        userId: a.userId,
        name: nameOf(a.userId),
        activityScore: (a._sum.watchTimeSec ?? 0) + (a._sum.lessonsDone ?? 0) * 100,
      }));

    return { topStudents, topCertificateUsers, highestScores, mostActive };
  }

  static async getTeacherStats(teacherId: string) {
    const profile = await prisma.teacherProfile.findUnique({
      where: { id: teacherId },
      include: {
        subjects: { include: { subject: true } },
        ratings: true,
        complaints: true,
      },
    });
    if (!profile) return null;

    const subjectIds = profile.subjects.map((s) => s.subjectId);
    const studentCount = await prisma.subscription.count({
      where: {
        status: "ACTIVE",
        package: { subjectId: { in: subjectIds } },
      },
    });

    const avgRating =
      profile.ratings.length > 0
        ? profile.ratings.reduce((s, r) => s + r.rating, 0) / profile.ratings.length
        : 0;

    return {
      studentCount,
      courseCount: subjectIds.length,
      complaintCount: profile.complaints.length,
      avgRating,
      ratings: profile.ratings,
    };
  }
}
