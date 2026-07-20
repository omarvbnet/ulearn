import { json, optionalAuth } from "@/lib/api";
import { CacheTTL } from "@/lib/prisma-cache";
import { prisma } from "@/lib/prisma";
import { resolvePublicMediaUrl } from "@/lib/r2";
import { CourseGroupService } from "@/services/course-group.service";
import { CourseRatingService } from "@/services/course-rating.service";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { AiExamService } from "@/services/ai";
import type { TeacherLevel } from "@prisma/client";

const LEVELS: TeacherLevel[] = ["GOOD", "EXCELLENT", "MASTER"];

/**
 * Mobile home feed. Public browse supported; engagement fields fill in when signed in.
 * CERTIFICATE_USER: filter courses by areas of interest (subjectIds).
 */
export async function GET(request: Request) {
  const session = await optionalAuth();
  const userId = session?.userId;

  const { searchParams } = new URL(request.url);
  const explicitStageId = searchParams.get("stageId") ?? undefined;
  const interestSubjectId = searchParams.get("subjectId") ?? undefined;
  const interestSubjectIdsParam = searchParams.get("subjectIds");
  const interestSubjectIds = interestSubjectIdsParam
    ? interestSubjectIdsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const q = searchParams.get("q") ?? undefined;
  const levelParam = searchParams.get("level") ?? undefined;
  const localeParam = searchParams.get("locale")?.toUpperCase();
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
          certificateProfile: {
            include: {
              interests: {
                include: {
                  subject: {
                    select: {
                      id: true,
                      nameEn: true,
                      nameAr: true,
                      nameKu: true,
                      nameTr: true,
                      stageId: true,
                      stage: {
                        select: {
                          id: true,
                          nameEn: true,
                          nameAr: true,
                          nameKu: true,
                          nameTr: true,
                          isCertificateTrack: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
    : null;

  const isCertificateUser = user?.role === "CERTIFICATE_USER";
  const interestSubjects =
    user?.certificateProfile?.interests.map((i) => i.subject) ?? [];
  const interestIds = interestSubjects.map((s) => s.id);
  const certStage = interestSubjects.find((s) => s.stage)?.stage ?? null;

  const schoolStage = user?.studentProfile?.educationalStage ?? null;
  const stage = isCertificateUser ? certStage : schoolStage;

  let stageId: string | undefined;
  let subjectIds: string[] | undefined;
  let subjectId: string | undefined;

  if (isCertificateUser) {
    if (explicitStageId === "all") {
      stageId = undefined;
      subjectIds = undefined;
    } else if (interestSubjectIds?.length) {
      const allowed = interestSubjectIds.filter((id) => interestIds.includes(id));
      subjectIds = allowed.length ? allowed : interestIds.length ? interestIds : undefined;
      stageId = certStage?.id;
    } else if (interestSubjectId && interestIds.includes(interestSubjectId)) {
      subjectId = interestSubjectId;
      stageId = certStage?.id;
    } else if (interestIds.length) {
      subjectIds = interestIds;
      stageId = certStage?.id;
    } else if (certStage?.id) {
      stageId = certStage.id;
    }
  } else {
    stageId =
      explicitStageId === "all" ? undefined : (explicitStageId ?? schoolStage?.id);
  }

  const now = new Date();
  const adsLocale =
    (localeParam === "AR" ||
    localeParam === "EN" ||
    localeParam === "KU" ||
    localeParam === "TR"
      ? localeParam
      : null) ||
    user?.locale ||
    "AR";

  // Ads + stages are shared across users — cache via Accelerate.
  // Course likes (likedByMe) stay uncached when signed in.
  const [adsRaw, courses, stages] = await Promise.all([
    userId
      ? prisma.advertisement.findMany({
          where: {
            isActive: true,
            deletedAt: null,
            locale: adsLocale,
            OR: [{ startsAt: null }, { startsAt: { lte: now } }],
            AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
          },
          orderBy: { sortOrder: "asc" },
          include: {
            _count: { select: { likes: true } },
            likes: { where: { userId }, select: { id: true } },
          },
        })
      : prisma.advertisement.findMany({
          where: {
            isActive: true,
            deletedAt: null,
            locale: adsLocale,
            OR: [{ startsAt: null }, { startsAt: { lte: now } }],
            AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
          },
          orderBy: { sortOrder: "asc" },
          include: {
            _count: { select: { likes: true } },
          },
          cacheStrategy: CacheTTL.catalog,
        }),
    TeacherCourseService.listPublishedCourses({
      stageId,
      subjectId,
      subjectIds,
      q,
      levels,
    }),
    prisma.educationalStage.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(isCertificateUser ? { isCertificateTrack: true } : { isCertificateTrack: false }),
      },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        nameKu: true,
        nameTr: true,
        isCertificateTrack: true,
      },
      cacheStrategy: CacheTTL.reference,
    }),
  ]);

  const ads = adsRaw.filter((a) => !a.countryId || a.countryId === user?.countryId);

  const adsOut = await Promise.all(
    ads.map(async (a) => {
      const imageUrl =
        (await resolvePublicMediaUrl(a.imageUrl, a.imageKey).catch(() => null)) ?? "";
      const title =
        a.title ||
        (adsLocale === "AR"
          ? a.titleAr
          : adsLocale === "KU"
            ? a.titleKu
            : adsLocale === "TR"
              ? a.titleTr
              : a.titleEn) ||
        a.titleEn ||
        a.titleAr ||
        a.titleKu ||
        a.titleTr ||
        null;
      return {
        id: a.id,
        locale: a.locale,
        title,
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

  const aiExamStats = userId
    ? await AiExamService.getStats(userId).catch(() => ({
        total: 0,
        passed: 0,
        failed: 0,
        avgScore: 0,
      }))
    : null;

  const groups = await CourseGroupService.listForHome({
    stageId: stageId && stageId !== "all" ? stageId : undefined,
    countryId: user?.countryId ?? undefined,
  }).catch((err) => {
    console.error("[home] course groups failed", err);
    return [];
  });

  return json({
    stage,
    stages,
    interests: interestSubjects,
    courses: coursesOut,
    groups,
    ads: adsOut,
    aiExamStats,
  });
}
