import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { SubscriptionService } from "@/services/subscription.service";

export type CourseSuggestion = {
  id: string;
  title: string;
  teacherName: string | null;
  price: number;
  currency: string;
  likes: number;
  viewCount: number;
  courseRating: number;
  thumbnailUrl: string | null;
  purchaseStatus: string | null;
};

function pickTitle(
  c: {
    titleEn: string;
    titleAr?: string | null;
    titleKu?: string | null;
    titleTr?: string | null;
  },
  language: string
) {
  if (language === "ar" && c.titleAr) return c.titleAr;
  if (language === "ku" && c.titleKu) return c.titleKu;
  if (language === "tr" && c.titleTr) return c.titleTr;
  return c.titleEn;
}

function wantsCourseSuggestions(question: string): boolean {
  const q = question.toLowerCase();
  return /(course|courses|recommend|suggestion|suggest|subscribe|subscription|enroll|class|lesson plan|what should i (study|take|buy)|دورة|دورات|كورس|اشتراك|اقترح|توصية|خول|پێشنیار|kurs|öner|abonelik)/i.test(
    q
  );
}

/**
 * Builds quiz/subscription/purchase context + stage-scoped course suggestions
 * for student & certificate AI tutoring.
 */
export class StudentLearningContextService {
  static wantsCourseSuggestions = wantsCourseSuggestions;

  static async build(input: {
    userId: string;
    language: string;
    stageId?: string | null;
    subjectIds?: string[];
    role?: string | null;
  }) {
    const [quizAttempts, subscriptions, purchases, suggestions] =
      await Promise.all([
        this.loadQuizContext(input.userId),
        this.loadSubscriptions(input.userId, input.language),
        this.loadPurchases(input.userId, input.language),
        this.loadCourseSuggestions({
          userId: input.userId,
          stageId: input.stageId,
          subjectIds: input.subjectIds,
          language: input.language,
        }),
      ]);

    const promptBlurb = [
      quizAttempts.blurb,
      subscriptions.blurb,
      purchases.blurb,
      suggestions.length
        ? `In-stage store courses you may suggest (ONLY these — never invent courses outside this list). Prefer higher likes/views/ratings:\n${suggestions
            .map(
              (s, i) =>
                `${i + 1}. [${s.id}] "${s.title}" by ${s.teacherName || "teacher"} — likes ${s.likes}, views ${s.viewCount}, rating ${s.courseRating}, price ${s.price} ${s.currency}${s.purchaseStatus === "PAID" ? " (already purchased)" : ""}`
            )
            .join("\n")}`
        : "No published store courses match this student's stage/interests yet — do not invent course recommendations.",
      "When recommending courses, ONLY pick from the in-stage list above. Point the student to subscribe/view those courses. Use course evaluation from quiz results to personalize study advice.",
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      promptBlurb,
      courseSuggestions: suggestions.filter((s) => s.purchaseStatus !== "PAID"),
      quizSummary: quizAttempts.summary,
    };
  }

  private static async loadQuizContext(userId: string) {
    const attempts = await prisma.quizAttempt.findMany({
      where: { userId, completedAt: { not: null } },
      include: {
        quiz: {
          select: {
            id: true,
            titleEn: true,
            titleAr: true,
            type: true,
            courseId: true,
            subjectId: true,
            course: { select: { titleEn: true, titleAr: true } },
            subject: { select: { nameEn: true, nameAr: true } },
          },
        },
      },
      orderBy: { completedAt: "desc" },
      take: 40,
    });

    if (!attempts.length) {
      return {
        summary: { total: 0, passed: 0, failed: 0, avgScore: 0 },
        blurb: "Course/curriculum quiz history: none yet.",
      };
    }

    const passed = attempts.filter((a) => a.passed).length;
    const failed = attempts.length - passed;
    const avgScore =
      attempts.reduce((s, a) => s + a.percentage, 0) / attempts.length;

    const recent = attempts.slice(0, 12).map((a) => {
      const title =
        a.quiz.titleEn ||
        a.quiz.course?.titleEn ||
        a.quiz.subject?.nameEn ||
        "Quiz";
      return `- ${title} (${a.quiz.type}): ${Math.round(a.percentage)}% ${a.passed ? "PASSED" : "FAILED"}`;
    });

    const weak = attempts
      .filter((a) => !a.passed)
      .slice(0, 8)
      .map(
        (a) =>
          a.quiz.titleEn ||
          a.quiz.course?.titleEn ||
          a.quiz.subject?.nameEn ||
          "quiz"
      );

    return {
      summary: {
        total: attempts.length,
        passed,
        failed,
        avgScore: Math.round(avgScore * 10) / 10,
      },
      blurb: [
        `Course & curriculum quiz results (not only AI exams): total ${attempts.length}, passed ${passed}, failed ${failed}, avg ${Math.round(avgScore)}%.`,
        "Recent attempts:",
        ...recent,
        weak.length ? `Needs review: ${weak.join(", ")}` : null,
        "Use these results to evaluate progress and personalize study advice.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  private static async loadSubscriptions(userId: string, language: string) {
    const subs = await SubscriptionService.getUserSubscriptions(userId);
    const active = subs.filter((s) => s.status === "ACTIVE");
    if (!active.length) {
      return { blurb: "Active curriculum subscriptions: none." };
    }
    const lines = active.map((s) => {
      const pkg = s.package;
      const subject =
        language === "ar"
          ? pkg.subject?.nameAr || pkg.subject?.nameEn
          : pkg.subject?.nameEn || pkg.subject?.nameAr;
      const stage =
        language === "ar"
          ? pkg.stage?.nameAr || pkg.stage?.nameEn
          : pkg.stage?.nameEn || pkg.stage?.nameAr;
      return `- ${pkg.type}${subject ? ` / ${subject}` : ""}${stage ? ` @ ${stage}` : ""} (expires ${s.expiresAt?.toISOString().slice(0, 10) || "n/a"})`;
    });
    return {
      blurb: ["Active curriculum subscriptions:", ...lines].join("\n"),
    };
  }

  private static async loadPurchases(userId: string, language: string) {
    const purchases = await prisma.coursePurchase.findMany({
      where: { userId, status: "PAID" },
      include: {
        course: {
          select: {
            id: true,
            titleEn: true,
            titleAr: true,
            titleKu: true,
            titleTr: true,
            stageId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    if (!purchases.length) {
      return { blurb: "Purchased store courses: none." };
    }
    const lines = purchases.map(
      (p) => `- [${p.course.id}] ${pickTitle(p.course, language)}`
    );
    return {
      blurb: ["Purchased / owned store courses:", ...lines].join("\n"),
    };
  }

  /** Only same-stage (and cert subject) published courses, ranked by likes → views → rating. */
  static async loadCourseSuggestions(input: {
    userId: string;
    stageId?: string | null;
    subjectIds?: string[];
    language: string;
    take?: number;
  }): Promise<CourseSuggestion[]> {
    if (!input.stageId && !input.subjectIds?.length) return [];

    const courses = await TeacherCourseService.listPublishedCourses({
      stageId: input.stageId || undefined,
      subjectIds: input.subjectIds?.length ? input.subjectIds : undefined,
    });
    if (!courses.length) return [];

    const enriched = await TeacherCourseService.enrichCoursesForUser(
      courses,
      input.userId
    );

    const ranked = [...enriched].sort((a, b) => {
      const likesA = a.likes ?? 0;
      const likesB = b.likes ?? 0;
      if (likesB !== likesA) return likesB - likesA;
      const viewsA = a.viewCount ?? 0;
      const viewsB = b.viewCount ?? 0;
      if (viewsB !== viewsA) return viewsB - viewsA;
      const ratingA = a.courseRating ?? 0;
      const ratingB = b.courseRating ?? 0;
      if (ratingB !== ratingA) return ratingB - ratingA;
      const trA = a.teacherRating ?? 0;
      const trB = b.teacherRating ?? 0;
      return trB - trA;
    });

    return ranked.slice(0, input.take ?? 8).map((c) => ({
      id: c.id,
      title: pickTitle(c, input.language),
      teacherName: c.teacher?.user?.fullLegalName ?? null,
      price: c.price,
      currency: c.currency,
      likes: c.likes ?? 0,
      viewCount: c.viewCount ?? 0,
      courseRating: c.courseRating ?? 0,
      thumbnailUrl: (c.thumbnail as string | null) ?? null,
      purchaseStatus: (c.purchaseStatus as string | null) ?? null,
    }));
  }
}
