import { json, optionalAuth } from "@/lib/api";
import { withCache, CacheTTL } from "@/lib/prisma-cache";
import { prisma } from "@/lib/prisma";
import { resolvePublicMediaUrl } from "@/lib/r2";
import { CourseGroupService } from "@/services/course-group.service";
import { CourseRatingService } from "@/services/course-rating.service";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { AiExamService } from "@/services/ai";
import type { AdAudience, TeacherLevel, UserRole } from "@prisma/client";

const LEVELS: TeacherLevel[] = ["GOOD", "EXCELLENT", "MASTER"];

function adAudienceForRole(role?: UserRole | null): AdAudience[] {
  if (role === "STUDENT") return ["ALL", "STUDENT"];
  if (role === "CERTIFICATE_USER") return ["ALL", "CERTIFICATE_USER"];
  if (role === "TEACHER") return ["ALL", "TEACHER"];
  return ["ALL"];
}

/**
 * Mobile home feed. Public browse supported; engagement fields fill in when signed in.
 * CERTIFICATE_USER: default courses by interests; when they pick a school stage
 * (e.g. 3rd Intermediate), courses/groups/ads follow that stage like students.
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
  const defaultStage = isCertificateUser ? certStage : schoolStage;

  let stageId: string | undefined;
  let subjectIds: string[] | undefined;
  let subjectId: string | undefined;
  /** Stage used for ads + course groups (same picker as courses). */
  let promoStageId: string | undefined;

  const pickedConcreteStage =
    explicitStageId && explicitStageId !== "all" ? explicitStageId : undefined;

  if (isCertificateUser) {
    if (explicitStageId === "all") {
      stageId = undefined;
      subjectIds = undefined;
      promoStageId = undefined;
    } else if (pickedConcreteStage) {
      // Cert user browsing a school/cert stage — show that stage's courses, groups, ads.
      stageId = pickedConcreteStage;
      subjectIds = undefined;
      subjectId = undefined;
      promoStageId = pickedConcreteStage;
    } else if (interestSubjectIds?.length) {
      const allowed = interestSubjectIds.filter((id) => interestIds.includes(id));
      subjectIds = allowed.length ? allowed : interestIds.length ? interestIds : undefined;
      stageId = certStage?.id;
      promoStageId = certStage?.id;
    } else if (interestSubjectId && interestIds.includes(interestSubjectId)) {
      subjectId = interestSubjectId;
      stageId = certStage?.id;
      promoStageId = certStage?.id;
    } else if (interestIds.length) {
      subjectIds = interestIds;
      stageId = certStage?.id;
      promoStageId = certStage?.id;
    } else if (certStage?.id) {
      stageId = certStage.id;
      promoStageId = certStage.id;
    }
  } else {
    stageId =
      explicitStageId === "all" ? undefined : (explicitStageId ?? schoolStage?.id);
    promoStageId = stageId;
  }

  const stage =
    (pickedConcreteStage
      ? await prisma.educationalStage
          .findFirst({
            where: { id: pickedConcreteStage, deletedAt: null },
            select: {
              id: true,
              nameEn: true,
              nameAr: true,
              nameKu: true,
              nameTr: true,
              isCertificateTrack: true,
            },
          })
          .catch(() => null)
      : null) || defaultStage;

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

  const audiences = adAudienceForRole(user?.role);

  const adsWhere = {
    isActive: true as const,
    deletedAt: null,
    locale: adsLocale as "AR" | "EN" | "KU" | "TR",
    audience: { in: audiences },
    OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    AND: [
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ...(promoStageId
        ? [{ OR: [{ stageId: null }, { stageId: promoStageId }] }]
        : []),
    ],
  };

  // Cert users get school + certificate stages so they can browse intermediate groups/ads.
  const stagesWhere = {
    isActive: true,
    deletedAt: null,
    ...(user?.countryId ? { countryId: user.countryId } : {}),
    ...(isCertificateUser
      ? {}
      : { isCertificateTrack: false }),
  };

  const [adsRaw, courses, stages] = await Promise.all([
    userId
      ? prisma.advertisement.findMany({
          where: adsWhere,
          orderBy: { sortOrder: "asc" },
          include: {
            _count: { select: { likes: true } },
            likes: { where: { userId }, select: { id: true } },
            stage: {
              select: {
                id: true,
                nameEn: true,
                nameAr: true,
                nameKu: true,
                nameTr: true,
              },
            },
          },
        })
      : prisma.advertisement.findMany(
          withCache(
            {
              where: {
                ...adsWhere,
                audience: { in: ["ALL"] as AdAudience[] },
              },
              orderBy: { sortOrder: "asc" as const },
              include: {
                _count: { select: { likes: true } },
                stage: {
                  select: {
                    id: true,
                    nameEn: true,
                    nameAr: true,
                    nameKu: true,
                    nameTr: true,
                  },
                },
              },
            },
            CacheTTL.catalog
          )
        ),
    TeacherCourseService.listPublishedCourses({
      stageId,
      subjectId,
      subjectIds,
      q,
      levels,
    }),
    prisma.educationalStage.findMany(
      withCache(
        {
          where: stagesWhere,
          orderBy: [
            { isCertificateTrack: "asc" as const },
            { sortOrder: "asc" as const },
          ],
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            nameKu: true,
            nameTr: true,
            isCertificateTrack: true,
          },
        },
        CacheTTL.reference
      )
    ),
  ]);

  const ads = adsRaw.filter((a) => !a.countryId || a.countryId === user?.countryId);

  const [adsOut, coursesOut, aiExamStats, groups] = await Promise.all([
    Promise.all(
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
          audience: a.audience,
          stageId: a.stageId,
          stage: a.stage,
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
    ),
    TeacherCourseService.enrichCoursesForUser(courses, userId).then((enriched) =>
      CourseRatingService.sortForHomeFeed(enriched)
    ),
    userId
      ? AiExamService.getStats(userId).catch(() => ({
          total: 0,
          passed: 0,
          failed: 0,
          avgScore: 0,
        }))
      : Promise.resolve(null),
    CourseGroupService.listForHome({
      stageId: promoStageId,
      countryId: user?.countryId ?? undefined,
    }).catch((err) => {
      console.error("[home] course groups failed", err);
      return [];
    }),
  ]);

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
