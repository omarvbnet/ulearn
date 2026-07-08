import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class QuizService {
  static async getQuizForUser(quizId: string, userId: string) {
    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId, deletedAt: null, isActive: true },
      include: { questions: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
    if (!quiz) return { success: false as const, error: "NOT_FOUND" };

    if (quiz.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: quiz.courseId, deletedAt: null, status: "APPROVED" },
        select: { price: true },
      });
      if (!course) return { success: false as const, error: "NOT_FOUND" };

      const purchased = await prisma.coursePurchase.findFirst({
        where: { courseId: quiz.courseId, userId, status: "PAID" },
      });
      if (!purchased && course.price > 0) {
        return { success: false as const, error: "NO_ACCESS" };
      }
    }

    const attempts = await prisma.quizAttempt.count({
      where: { quizId, userId, completedAt: { not: null } },
    });

    if (attempts >= quiz.maxAttempts) {
      return { success: false as const, error: "MAX_ATTEMPTS" };
    }

    const questions = quiz.randomize
      ? shuffle(quiz.questions)
      : quiz.questions;

    // Strip correct answers from client payload
    const safeQuestions = questions.map((q) => ({
      id: q.id,
      type: q.type,
      textEn: q.textEn,
      textAr: q.textAr,
      textKu: q.textKu,
      textTr: q.textTr,
      options: q.options,
      points: q.points,
    }));

    return {
      success: true as const,
      quiz: {
        id: quiz.id,
        type: quiz.type,
        titleEn: quiz.titleEn,
        titleAr: quiz.titleAr,
        titleKu: quiz.titleKu,
        titleTr: quiz.titleTr,
        timeLimitSec: quiz.timeLimitSec,
        maxAttempts: quiz.maxAttempts,
        attemptsUsed: attempts,
        passPercentage: quiz.passPercentage,
        questions: safeQuestions,
      },
    };
  }

  static async submitAttempt(params: {
    quizId: string;
    userId: string;
    answers: Record<string, string>;
    timeSpentSec?: number;
  }) {
    const quiz = await prisma.quiz.findFirst({
      where: { id: params.quizId, deletedAt: null },
      include: { questions: { where: { deletedAt: null } } },
    });
    if (!quiz) return { success: false as const, error: "NOT_FOUND" };

    if (quiz.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: quiz.courseId, deletedAt: null, status: "APPROVED" },
        select: { price: true },
      });
      if (!course) return { success: false as const, error: "NOT_FOUND" };

      const purchased = await prisma.coursePurchase.findFirst({
        where: { courseId: quiz.courseId, userId: params.userId, status: "PAID" },
      });
      if (!purchased && course.price > 0) {
        return { success: false as const, error: "NO_ACCESS" };
      }
    }

    const attempts = await prisma.quizAttempt.count({
      where: { quizId: params.quizId, userId: params.userId, completedAt: { not: null } },
    });
    if (attempts >= quiz.maxAttempts) {
      return { success: false as const, error: "MAX_ATTEMPTS" };
    }

    let score = 0;
    let maxScore = 0;

    for (const q of quiz.questions) {
      maxScore += q.points;
      if (params.answers[q.id] === q.correctKey) {
        score += q.points;
      }
    }

    const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
    const passed = percentage >= quiz.passPercentage;

    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId: params.quizId,
        userId: params.userId,
        score,
        maxScore,
        percentage,
        passed,
        answers: params.answers,
        completedAt: new Date(),
        timeSpentSec: params.timeSpentSec,
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.dailyActivity.upsert({
      where: { userId_date: { userId: params.userId, date: today } },
      create: { userId: params.userId, date: today, quizzesTaken: 1 },
      update: { quizzesTaken: { increment: 1 } },
    });

    return { success: true as const, attempt };
  }

  static async createQuiz(
    data: Prisma.QuizCreateInput & {
      questions?: Array<{
        type?: "MULTIPLE_CHOICE" | "TRUE_FALSE";
        textEn: string;
        textAr: string;
        textKu: string;
        textTr: string;
        options: Prisma.InputJsonValue;
        correctKey: string;
        points?: number;
      }>;
    }
  ) {
    const { questions, ...quizData } = data;
    return prisma.quiz.create({
      data: {
        ...quizData,
        questions: questions
          ? {
              create: questions.map((q, i) => ({
                ...q,
                type: q.type ?? "MULTIPLE_CHOICE",
                points: q.points ?? 1,
                sortOrder: i,
              })),
            }
          : undefined,
      },
      include: { questions: true },
    });
  }

  static async getUserStats(userId: string) {
    const attempts = await prisma.quizAttempt.findMany({
      where: { userId, completedAt: { not: null } },
      include: { quiz: true },
      orderBy: { completedAt: "desc" },
    });

    const avgScore =
      attempts.length > 0
        ? attempts.reduce((s, a) => s + a.percentage, 0) / attempts.length
        : 0;

    const passed = attempts.filter((a) => a.passed).length;
    const failed = attempts.length - passed;

    return { attempts, avgScore, passed, failed, total: attempts.length };
  }
}
