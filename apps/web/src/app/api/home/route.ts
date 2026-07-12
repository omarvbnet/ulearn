import { json, optionalAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { resolvePublicMediaUrl } from "@/lib/r2";
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

  const aiExamStats = userId
    ? await AiExamService.getStats(userId).catch(() => ({
        total: 0,
        passed: 0,
        failed: 0,
        avgScore: 0,
      }))
    : null;

  return json({
    stage,
    stages,
    interests: interestSubjects,
    courses: coursesOut,
    ads: adsOut,
    aiExamStats,
  });
}
