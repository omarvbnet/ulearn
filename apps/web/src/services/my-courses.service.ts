import { prisma } from "@/lib/prisma";
import { computeVideoCompletion } from "@/lib/video-progress.util";
import type { UserRole } from "@prisma/client";

type QuizSummaryOut = {
  id: string;
  titleEn: string;
  titleAr: string;
  titleKu: string;
  titleTr: string;
  passPercentage: number;
  bestPercentage: number | null;
  passed: boolean | null;
  timeSpentSec: number | null;
  completedAt: Date | null;
  attempts: number;
};

type CompletedCourseOut = {
  type: "store" | "curriculum";
  id: string;
  titleEn: string;
  titleAr: string | null;
  titleKu: string | null;
  titleTr: string | null;
  thumbnail: string | null;
  teacherName: string | null;
  lessonCount: number;
  totalDurationSec: number;
  completedAt: Date;
  resumeLessonId?: string | null;
  quizzes: QuizSummaryOut[];
};

function quizSummary(
  quiz: {
    id: string;
    titleEn: string;
    titleAr: string;
    titleKu: string;
    titleTr: string;
    passPercentage: number;
  },
  attempts: {
    percentage: number;
    passed: boolean;
    timeSpentSec: number | null;
    completedAt: Date | null;
  }[]
): QuizSummaryOut {
  const best = attempts.length
    ? attempts.reduce((a, b) => (b.percentage > a.percentage ? b : a))
    : null;
  return {
    id: quiz.id,
    titleEn: quiz.titleEn,
    titleAr: quiz.titleAr,
    titleKu: quiz.titleKu,
    titleTr: quiz.titleTr,
    passPercentage: quiz.passPercentage,
    bestPercentage: best?.percentage ?? null,
    passed: best?.passed ?? null,
    timeSpentSec: best?.timeSpentSec ?? null,
    completedAt: best?.completedAt ?? null,
    attempts: attempts.length,
  };
}

function pctFromProgress(
  lessons: { id: string; durationSec: number | null }[],
  progress: { lessonId: string; completionPct: number; isCompleted: boolean }[]
) {
  if (lessons.length === 0) return 0;
  const map = new Map(progress.map((p) => [p.lessonId, p]));
  let totalWeight = 0;
  let earned = 0;
  for (const l of lessons) {
    const w = l.durationSec && l.durationSec > 0 ? l.durationSec : 1;
    totalWeight += w;
    const p = map.get(l.id);
    if (p?.isCompleted) earned += w;
    else if (p) earned += w * (p.completionPct / 100);
  }
  return totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;
}

export class MyCoursesService {
  static async list(
    userId: string,
    role: UserRole,
    filter?: {
      q?: string;
      sort?: "recent" | "progress" | "title";
      minProgress?: number;
      teacherId?: string;
    }
  ) {
    const q = filter?.q?.trim().toLowerCase();
    const minProgress = filter?.minProgress ?? 0;

    // ── Store courses (paid purchases + free courses user bought/enrolled) ──
    const purchases = await prisma.coursePurchase.findMany({
      where: {
        userId,
        status: "PAID",
        course: { deletedAt: null, status: "APPROVED" },
      },
      include: {
        course: {
          include: {
            teacher: {
              select: {
                id: true,
                level: true,
                user: { select: { fullLegalName: true } },
              },
            },
            stage: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
            subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
            lessons: {
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                title: true,
                durationSec: true,
                thumbnailUrl: true,
                thumbnailKey: true,
              },
            },
          },
        },
      },
      orderBy: { approvedAt: "desc" },
    });

    const storeLessonIds = purchases.flatMap((p) => p.course.lessons.map((l) => l.id));
    const storeProgress = storeLessonIds.length
      ? await prisma.courseLessonProgress.findMany({
          where: { userId, lessonId: { in: storeLessonIds } },
        })
      : [];

    type CourseItem = {
      type: "store" | "curriculum";
      id: string;
      titleEn: string;
      titleAr: string | null;
      titleKu: string | null;
      titleTr: string | null;
      thumbnail: string | null;
      updatedAt: Date | null;
      teacherName: string | null;
      teacherId: string | null;
      teacherLevel: string | null;
      lessonCount: number;
      progressPct: number;
      resumeLessonId: string | null;
      lastWatchedAt: Date;
      stage: { nameEn: string; nameAr: string; nameKu: string; nameTr: string } | null;
      subject: { nameEn: string; nameAr: string; nameKu: string; nameTr: string } | null;
    };

    const { resolvePublicMediaUrl } = await import("@/lib/r2");

    const storeCourses: CourseItem[] = await Promise.all(
      purchases.map(async (p) => {
        const c = p.course;
        const lessonIds = c.lessons.map((l) => l.id);
        const prog = storeProgress.filter((pr) => lessonIds.includes(pr.lessonId));
        const progressPct = pctFromProgress(c.lessons, prog);
        const last = prog.sort(
          (a, b) => b.lastWatchedAt.getTime() - a.lastWatchedAt.getTime()
        )[0];
        const resumeLessonId =
          last?.lessonId ??
          (prog.find((pr) => !pr.isCompleted)?.lessonId ?? c.lessons[0]?.id ?? null);

        const firstLesson = c.lessons[0];
        const thumbnail =
          (await resolvePublicMediaUrl(c.thumbnail, null).catch(() => null)) ??
          (firstLesson
            ? await resolvePublicMediaUrl(
                firstLesson.thumbnailUrl,
                firstLesson.thumbnailKey
              ).catch(() => null)
            : null);

        return {
          type: "store" as const,
          id: c.id,
          titleEn: c.titleEn,
          titleAr: c.titleAr,
          titleKu: c.titleKu,
          titleTr: c.titleTr,
          thumbnail,
          updatedAt: c.updatedAt,
          teacherName: c.teacher.user.fullLegalName,
          teacherId: c.teacher.id,
          teacherLevel: c.teacher.level,
          lessonCount: c.lessons.length,
          progressPct,
          resumeLessonId,
          lastWatchedAt: last?.lastWatchedAt ?? p.approvedAt ?? p.createdAt,
          stage: c.stage,
          subject: c.subject,
        };
      })
    );

    // ── Curriculum subscriptions ──
    const now = new Date();
    const subs = await prisma.subscription.findMany({
      where: {
        userId,
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        package: {
          include: {
            subject: {
              include: {
                chapters: {
                  where: { deletedAt: null },
                  include: {
                    lessons: {
                      where: { deletedAt: null },
                      select: { id: true, durationSec: true },
                    },
                  },
                },
              },
            },
            stage: true,
          },
        },
      },
    });

    const curriculumItems: CourseItem[] = [];
    for (const sub of subs) {
      const pkg = sub.package;
      if (pkg.type === "FULL_STAGE") continue; // aggregated below if needed
      const subject = pkg.subject;
      if (!subject) continue;
      if (role === "TEACHER" && !subject.isCertificateProgram) continue;

      const lessons = subject.chapters.flatMap((ch) => ch.lessons);
      const lessonIds = lessons.map((l) => l.id);
      const prog = lessonIds.length
        ? await prisma.videoProgress.findMany({
            where: { userId, lessonId: { in: lessonIds } },
          })
        : [];
      const progressPct = pctFromProgress(
        lessons,
        prog.map((p) => ({
          lessonId: p.lessonId,
          completionPct: p.completionPct,
          isCompleted: p.isCompleted,
        }))
      );
      const last = prog.sort(
        (a, b) => b.lastWatchedAt.getTime() - a.lastWatchedAt.getTime()
      )[0];
      const resumeLessonId =
        last?.lessonId ??
        (prog.find((p) => !p.isCompleted)?.lessonId ?? lessons[0]?.id ?? null);

      curriculumItems.push({
        type: "curriculum" as const,
        id: subject.id,
        titleEn: subject.nameEn,
        titleAr: subject.nameAr,
        titleKu: subject.nameKu,
        titleTr: subject.nameTr,
        thumbnail: null,
        updatedAt: null,
        teacherName: null,
        teacherId: null,
        teacherLevel: null,
        lessonCount: lessons.length,
        progressPct,
        resumeLessonId,
        lastWatchedAt: last?.lastWatchedAt ?? sub.startsAt ?? sub.createdAt,
        stage: pkg.stage
          ? {
              nameEn: pkg.stage.nameEn,
              nameAr: pkg.stage.nameAr,
              nameKu: pkg.stage.nameKu,
              nameTr: pkg.stage.nameTr,
            }
          : null,
        subject: {
          nameEn: subject.nameEn,
          nameAr: subject.nameAr,
          nameKu: subject.nameKu,
          nameTr: subject.nameTr,
        },
      });
    }

    let items: CourseItem[] = [...storeCourses, ...curriculumItems];

    if (q) {
      items = items.filter((c) => {
        const hay = [
          c.titleEn,
          c.titleAr,
          c.titleKu,
          c.titleTr,
          c.teacherName,
          c.subject?.nameEn,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (filter?.teacherId) {
      items = items.filter((c) => c.teacherId === filter.teacherId);
    }

    if (minProgress > 0) {
      items = items.filter((c) => c.progressPct >= minProgress);
    }

    const sort = filter?.sort ?? "recent";
    items.sort((a, b) => {
      if (sort === "progress") return b.progressPct - a.progressPct;
      if (sort === "title") return (a.titleEn ?? "").localeCompare(b.titleEn ?? "");
      const ta = a.lastWatchedAt ? new Date(a.lastWatchedAt).getTime() : 0;
      const tb = b.lastWatchedAt ? new Date(b.lastWatchedAt).getTime() : 0;
      return tb - ta;
    });

    return { courses: items, role };
  }

  static async listCompleted(userId: string, role: UserRole) {
    const { courses: enrolled } = await this.list(userId, role, { sort: "recent" });
    if (enrolled.length === 0) {
      return {
        summary: {
          totalCourses: 0,
          totalCompletionTimeSec: 0,
          quizzesTaken: 0,
          quizzesPassed: 0,
        },
        courses: [] as CompletedCourseOut[],
      };
    }

    const storeIds = enrolled.filter((c) => c.type === "store").map((c) => c.id);
    const curriculumIds = enrolled.filter((c) => c.type === "curriculum").map((c) => c.id);

    const [storeCourses, subjects, storeQuizzes, subjectQuizzes] = await Promise.all([
      storeIds.length
        ? prisma.course.findMany({
            where: { id: { in: storeIds }, deletedAt: null },
            include: {
              teacher: { select: { user: { select: { fullLegalName: true } } } },
              lessons: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, durationSec: true },
              },
            },
          })
        : [],
      curriculumIds.length
        ? prisma.subject.findMany({
            where: { id: { in: curriculumIds }, deletedAt: null },
            include: {
              chapters: {
                where: { deletedAt: null },
                include: {
                  lessons: {
                    where: { deletedAt: null },
                    select: { id: true, durationSec: true },
                  },
                },
              },
            },
          })
        : [],
      storeIds.length
        ? prisma.quiz.findMany({
            where: {
              courseId: { in: storeIds },
              deletedAt: null,
              isActive: true,
            },
            select: {
              id: true,
              courseId: true,
              titleEn: true,
              titleAr: true,
              titleKu: true,
              titleTr: true,
              passPercentage: true,
            },
          })
        : [],
      curriculumIds.length
        ? prisma.quiz.findMany({
            where: {
              subjectId: { in: curriculumIds },
              deletedAt: null,
              isActive: true,
            },
            select: {
              id: true,
              subjectId: true,
              titleEn: true,
              titleAr: true,
              titleKu: true,
              titleTr: true,
              passPercentage: true,
            },
          })
        : [],
    ]);

    const allLessonIds = [
      ...storeCourses.flatMap((c) => c.lessons.map((l) => l.id)),
      ...subjects.flatMap((s) => s.chapters.flatMap((ch) => ch.lessons.map((l) => l.id))),
    ];

    const [storeProgress, videoProgress] = await Promise.all([
      allLessonIds.length
        ? prisma.courseLessonProgress.findMany({
            where: { userId, lessonId: { in: allLessonIds } },
          })
        : [],
      allLessonIds.length
        ? prisma.videoProgress.findMany({
            where: { userId, lessonId: { in: allLessonIds } },
          })
        : [],
    ]);

    const storeProgByLesson = new Map(storeProgress.map((p) => [p.lessonId, p]));
    const videoProgByLesson = new Map(videoProgress.map((p) => [p.lessonId, p]));

    const allQuizIds = [...storeQuizzes, ...subjectQuizzes].map((q) => q.id);
    const attempts = allQuizIds.length
      ? await prisma.quizAttempt.findMany({
          where: { userId, quizId: { in: allQuizIds }, completedAt: { not: null } },
          orderBy: { completedAt: "desc" },
        })
      : [];

    const attemptsByQuiz = new Map<string, typeof attempts>();
    for (const a of attempts) {
      const list = attemptsByQuiz.get(a.quizId) ?? [];
      list.push(a);
      attemptsByQuiz.set(a.quizId, list);
    }

    const completed: CompletedCourseOut[] = [];

    for (const item of enrolled) {
      if (item.type === "store") {
        const course = storeCourses.find((c) => c.id === item.id);
        if (!course || course.lessons.length === 0) continue;
        const prog = course.lessons.map((l) => storeProgByLesson.get(l.id)).filter(Boolean) as {
          lessonId: string;
          isCompleted: boolean;
          lastWatchedAt: Date;
        }[];
        if (!course.lessons.every((l) => storeProgByLesson.get(l.id)?.isCompleted)) continue;

        const totalDurationSec = course.lessons.reduce((s, l) => s + (l.durationSec ?? 0), 0);
        const completedAt =
          prog.length > 0
            ? new Date(Math.max(...prog.map((p) => p.lastWatchedAt.getTime())))
            : item.lastWatchedAt;

        const courseQuizzes = storeQuizzes.filter((q) => q.courseId === course.id);
        completed.push({
          type: "store",
          id: course.id,
          titleEn: item.titleEn,
          titleAr: item.titleAr,
          titleKu: item.titleKu,
          titleTr: item.titleTr,
          thumbnail: item.thumbnail,
          teacherName: item.teacherName,
          lessonCount: course.lessons.length,
          totalDurationSec,
          completedAt,
          quizzes: courseQuizzes.map((q) => quizSummary(q, attemptsByQuiz.get(q.id) ?? [])),
        });
      } else {
        const subject = subjects.find((s) => s.id === item.id);
        if (!subject) continue;
        const lessons = subject.chapters.flatMap((ch) => ch.lessons);
        if (lessons.length === 0) continue;
        if (!lessons.every((l) => videoProgByLesson.get(l.id)?.isCompleted)) continue;

        const prog = lessons.map((l) => videoProgByLesson.get(l.id)).filter(Boolean) as {
          lastWatchedAt: Date;
        }[];
        const totalDurationSec = lessons.reduce((s, l) => s + (l.durationSec ?? 0), 0);
        const completedAt =
          prog.length > 0
            ? new Date(Math.max(...prog.map((p) => p.lastWatchedAt.getTime())))
            : item.lastWatchedAt;

        const subjectQuizList = subjectQuizzes.filter((q) => q.subjectId === subject.id);
        completed.push({
          type: "curriculum",
          id: subject.id,
          titleEn: item.titleEn,
          titleAr: item.titleAr,
          titleKu: item.titleKu,
          titleTr: item.titleTr,
          thumbnail: item.thumbnail,
          teacherName: null,
          lessonCount: lessons.length,
          totalDurationSec,
          completedAt,
          resumeLessonId: item.resumeLessonId ?? lessons[0]?.id ?? null,
          quizzes: subjectQuizList.map((q) => quizSummary(q, attemptsByQuiz.get(q.id) ?? [])),
        });
      }
    }

    completed.sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );

    const allQuizResults = completed.flatMap((c) => c.quizzes).filter((q) => q.attempts > 0);
    const totalCompletionTimeSec = completed.reduce((s, c) => s + c.totalDurationSec, 0);

    return {
      summary: {
        totalCourses: completed.length,
        totalCompletionTimeSec,
        quizzesTaken: allQuizResults.length,
        quizzesPassed: allQuizResults.filter((q) => q.passed).length,
      },
      courses: completed,
    };
  }

  static async updateStoreLessonProgress(input: {
    userId: string;
    lessonId: string;
    positionSec: number;
    durationSec: number;
    completed?: boolean;
  }) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: input.lessonId, course: { deletedAt: null } },
      include: {
        course: { select: { id: true, price: true, teacher: { select: { userId: true } } } },
      },
    });
    if (!lesson) return { success: false as const, error: "NOT_FOUND" };

    const purchased = await prisma.coursePurchase.findFirst({
      where: {
        userId: input.userId,
        courseId: lesson.courseId,
        status: "PAID",
      },
    });
    const isOwner = lesson.course.teacher.userId === input.userId;
    const timedFree =
      !lesson.isFreePreview &&
      typeof lesson.freePreviewSec === "number" &&
      lesson.freePreviewSec > 0;
    const isFree = lesson.course.price <= 0 || lesson.isFreePreview || timedFree;
    if (!purchased && !isFree && !isOwner) {
      return { success: false as const, error: "NO_ACCESS" };
    }

    // Cap progress for timed free previews so completion can't be faked.
    if (!purchased && !isOwner && timedFree && lesson.freePreviewSec != null) {
      input.positionSec = Math.min(input.positionSec, lesson.freePreviewSec);
      input.completed = false;
    }

    const existing = await prisma.courseLessonProgress.findUnique({
      where: { userId_lessonId: { userId: input.userId, lessonId: input.lessonId } },
    });

    let { completionPct, isCompleted, positionSec } = computeVideoCompletion({
      positionSec: input.positionSec,
      durationSec: input.durationSec,
      completed: input.completed,
    });

    // Once a lesson is completed, rewatches must not reset progress.
    if (existing?.isCompleted) {
      isCompleted = true;
      completionPct = 100;
      if (input.durationSec > 0) {
        positionSec = Math.max(existing.positionSec, input.durationSec);
      } else {
        positionSec = Math.max(existing.positionSec, positionSec);
      }
    }

    const row = await prisma.courseLessonProgress.upsert({
      where: { userId_lessonId: { userId: input.userId, lessonId: input.lessonId } },
      create: {
        userId: input.userId,
        lessonId: input.lessonId,
        positionSec,
        durationSec: input.durationSec,
        completionPct,
        isCompleted,
      },
      update: {
        positionSec,
        durationSec: input.durationSec,
        completionPct,
        isCompleted,
        lastWatchedAt: new Date(),
      },
    });

    // Backfill lesson duration when missing (fixes course total time on cards).
    if (input.durationSec > 0 && (!lesson.durationSec || lesson.durationSec < input.durationSec)) {
      await prisma.courseLesson.update({
        where: { id: input.lessonId },
        data: { durationSec: input.durationSec },
      });
    }

    return { success: true as const, progress: row };
  }
}
