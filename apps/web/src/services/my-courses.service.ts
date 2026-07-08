import { prisma } from "@/lib/prisma";
import { computeVideoCompletion } from "@/lib/video-progress.util";
import type { UserRole } from "@prisma/client";

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
              select: { id: true, title: true, durationSec: true, thumbnailUrl: true },
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

    const storeCourses: CourseItem[] = purchases.map((p) => {
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
      return {
        type: "store" as const,
        id: c.id,
        titleEn: c.titleEn,
        titleAr: c.titleAr,
        titleKu: c.titleKu,
        titleTr: c.titleTr,
        thumbnail: c.thumbnail,
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
    });

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

  static async updateStoreLessonProgress(input: {
    userId: string;
    lessonId: string;
    positionSec: number;
    durationSec: number;
    completed?: boolean;
  }) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: input.lessonId, course: { deletedAt: null } },
      include: { course: { select: { id: true, price: true } } },
    });
    if (!lesson) return { success: false as const, error: "NOT_FOUND" };

    const purchased = await prisma.coursePurchase.findFirst({
      where: {
        userId: input.userId,
        courseId: lesson.courseId,
        status: "PAID",
      },
    });
    const isFree = lesson.course.price <= 0 || lesson.isFreePreview;
    if (!purchased && !isFree) {
      return { success: false as const, error: "NO_ACCESS" };
    }

    const { completionPct, isCompleted, positionSec } = computeVideoCompletion({
      positionSec: input.positionSec,
      durationSec: input.durationSec,
      completed: input.completed,
    });

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

    return { success: true as const, progress: row };
  }
}
