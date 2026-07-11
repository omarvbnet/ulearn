import { json, optionalAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { resolvePublicMediaUrl } from "@/lib/r2";
import { CourseRatingService } from "@/services/course-rating.service";
import { TeacherCourseService } from "@/services/teacher-course.service";
import type { TeacherLevel } from "@prisma/client";

const LEVELS: TeacherLevel[] = ["GOOD", "EXCELLENT", "MASTER"];

/**
 * Mobile home feed. Public browse supported; engagement fields fill in when signed in.
 */
export async function GET(request: Request) {
  const session = await optionalAuth();
  const userId = session?.userId;

  const { searchParams } = new URL(request.url);
  const explicitStageId = searchParams.get("stageId") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const levelParam = searchParams.get("level") ?? undefined;
  const levels = levelParam
    ? (levelParam.split(",").filter((l) => LEVELS.includes(l as TeacherLevel)) as TeacherLevel[])
    : undefined;

  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        include: {
          studentProfile: {
            include: {
              educationalStage: {
                select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
              },
            },
          },
        },
      })
    : null;

  const stage = user?.studentProfile?.educationalStage ?? null;
  const stageId =
    explicitStageId === "all" ? undefined : (explicitStageId ?? stage?.id);

  const now = new Date();
  const [adsRaw, courses, stages] = await Promise.all([
    prisma.advertisement.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { sortOrder: "asc" },
      include: {
        _count: { select: { likes: true } },
        ...(userId
          ? { likes: { where: { userId }, select: { id: true } } }
          : {}),
      },
    }),
    TeacherCourseService.listPublishedCourses({ stageId, q, levels }),
    prisma.educationalStage.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
    }),
  ]);

  const ads = adsRaw.filter((a) => !a.countryId || a.countryId === user?.countryId);

  const adsOut = await Promise.all(
    ads.map(async (a) => {
      const imageUrl =
        (await resolvePublicMediaUrl(a.imageUrl, a.imageKey).catch(() => null)) ?? "";
      return {
        id: a.id,
        titleEn: a.titleEn,
        titleAr: a.titleAr,
        titleKu: a.titleKu,
        titleTr: a.titleTr,
        imageUrl,
        updatedAt: a.updatedAt,
        linkUrl: a.linkUrl,
        likes: a._count.likes,
        likedByMe: userId
          ? (("likes" in a ? (a.likes as { id: string }[]).length : 0) > 0)
          : false,
      };
    })
  );

  const coursesOut = CourseRatingService.sortForHomeFeed(
    await TeacherCourseService.enrichCoursesForUser(courses, userId)
  );

  return json({ stage, stages, ads: adsOut, courses: coursesOut });
}
