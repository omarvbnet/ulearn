import { prisma } from "@/lib/prisma";
import type { TeacherLevel } from "@prisma/client";

export const TEACHER_LEVEL_RANK: Record<TeacherLevel, number> = {
  NEEDS_IMPROVEMENT: 0,
  GOOD: 1,
  EXCELLENT: 2,
  MASTER: 3,
};

export class CourseRatingService {
  /** Whether the student finished every lesson and passed every quiz. */
  static async getCompletionStatus(courseId: string, userId: string) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null, status: "APPROVED" },
      include: {
        lessons: { select: { id: true } },
        quizzes: {
          where: { deletedAt: null, isActive: true },
          select: { id: true },
        },
      },
    });
    if (!course) return null;

    const lessonIds = course.lessons.map((l) => l.id);
    const progress =
      lessonIds.length > 0
        ? await prisma.courseLessonProgress.findMany({
            where: { userId, lessonId: { in: lessonIds } },
            select: { lessonId: true, isCompleted: true },
          })
        : [];
    const progressMap = new Map(progress.map((p) => [p.lessonId, p.isCompleted]));
    const lessonsComplete =
      lessonIds.length === 0 ||
      lessonIds.every((id) => progressMap.get(id) === true);

    const quizIds = course.quizzes.map((q) => q.id);
    let quizzesComplete = true;
    if (quizIds.length > 0) {
      const passed = await prisma.quizAttempt.findMany({
        where: {
          userId,
          quizId: { in: quizIds },
          passed: true,
          completedAt: { not: null },
        },
        select: { quizId: true },
        distinct: ["quizId"],
      });
      const passedSet = new Set(passed.map((p) => p.quizId));
      quizzesComplete = quizIds.every((id) => passedSet.has(id));
    }

    const fullyComplete = lessonsComplete && quizzesComplete;

    const [myRating, agg] = await Promise.all([
      prisma.courseRating.findUnique({
        where: { courseId_userId: { courseId, userId } },
        select: { rating: true, comment: true, createdAt: true },
      }),
      prisma.courseRating.aggregate({
        where: { courseId },
        _avg: { rating: true },
        _count: true,
      }),
    ]);

    return {
      lessonsComplete,
      quizzesComplete,
      fullyComplete,
      pendingEvaluation: fullyComplete && !myRating,
      myRating: myRating?.rating ?? null,
      myComment: myRating?.comment ?? null,
      courseRating:
        agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
      courseRatingCount: agg._count,
    };
  }

  static async submit(input: {
    courseId: string;
    userId: string;
    rating: number;
    comment?: string;
  }) {
    if (input.rating < 1 || input.rating > 5) {
      return { success: false as const, error: "INVALID_RATING" };
    }

    const status = await this.getCompletionStatus(input.courseId, input.userId);
    if (!status) return { success: false as const, error: "NOT_FOUND" };
    if (!status.fullyComplete) {
      return { success: false as const, error: "COURSE_NOT_COMPLETE" };
    }

    const purchased = await prisma.coursePurchase.findFirst({
      where: {
        userId: input.userId,
        courseId: input.courseId,
        status: "PAID",
      },
    });
    const course = await prisma.course.findFirst({
      where: { id: input.courseId },
      select: { price: true, teacher: { select: { userId: true } } },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" };
    const isOwner = course.teacher.userId === input.userId;
    const isFree = course.price <= 0;
    if (!purchased && !isFree && !isOwner) {
      return { success: false as const, error: "NO_ACCESS" };
    }

    const row = await prisma.courseRating.upsert({
      where: {
        courseId_userId: { courseId: input.courseId, userId: input.userId },
      },
      create: {
        courseId: input.courseId,
        userId: input.userId,
        rating: input.rating,
        comment: input.comment?.trim() || null,
      },
      update: {
        rating: input.rating,
        comment: input.comment?.trim() || null,
      },
    });

    const agg = await prisma.courseRating.aggregate({
      where: { courseId: input.courseId },
      _avg: { rating: true },
      _count: true,
    });

    return {
      success: true as const,
      rating: row,
      courseRating:
        agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : input.rating,
      courseRatingCount: agg._count,
    };
  }

  /** Sort home-feed courses: higher course rating, then teacher level, then teacher rating. */
  static sortForHomeFeed<
    T extends {
      courseRating?: number | null;
      teacherRating?: number;
      teacher?: { level?: TeacherLevel };
      createdAt?: Date | string;
    },
  >(courses: T[]): T[] {
    return [...courses].sort((a, b) => {
      const crA = a.courseRating ?? 0;
      const crB = b.courseRating ?? 0;
      if (crB !== crA) return crB - crA;

      const tlA = TEACHER_LEVEL_RANK[a.teacher?.level ?? "GOOD"] ?? 0;
      const tlB = TEACHER_LEVEL_RANK[b.teacher?.level ?? "GOOD"] ?? 0;
      if (tlB !== tlA) return tlB - tlA;

      const trA = a.teacherRating ?? 0;
      const trB = b.teacherRating ?? 0;
      if (trB !== trA) return trB - trA;

      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  }
}
