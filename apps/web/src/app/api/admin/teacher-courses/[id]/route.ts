import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getDownloadUrl, resolvePublicMediaUrl } from "@/lib/r2";
import { WHITEBOARD_PLAYBACK_EXPIRES_SEC } from "@/lib/r2-whiteboard";
import { TeacherCourseService } from "@/services/teacher-course.service";

/** Admin: full course detail for review (lessons, quizzes, documents, readiness). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    include: {
      teacher: {
        select: {
          id: true,
          level: true,
          isActive: true,
          user: { select: { fullLegalName: true, phone: true } },
        },
      },
      stage: { select: { nameEn: true, nameAr: true } },
      subject: { select: { nameEn: true, nameAr: true } },
      // pendingChangeSummary / lastApprovedSnapshot are scalar fields on Course
      lessons: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          fileKey: true,
          fileUrl: true,
          thumbnailUrl: true,
          thumbnailKey: true,
          durationSec: true,
          sortOrder: true,
          isFreePreview: true,
          isInterview: true,
          lessonType: true,
          whiteboardAssetId: true,
        },
      },
      materials: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          type: true,
          fileKey: true,
          fileUrl: true,
          mimeType: true,
          lessonId: true,
        },
      },
      quizzes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          titleEn: true,
          titleAr: true,
          afterLessonId: true,
          passPercentage: true,
          timeLimitSec: true,
          maxAttempts: true,
          questions: {
            where: { deletedAt: null },
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              textEn: true,
              textAr: true,
              textKu: true,
              textTr: true,
              options: true,
              correctKey: true,
              points: true,
              timeLimitSec: true,
              type: true,
            },
          },
          _count: { select: { questions: { where: { deletedAt: null } } } },
        },
      },
      _count: {
        select: {
          purchases: { where: { status: "PAID" } },
        },
      },
    },
  });

  if (!course) return error("Course not found", 404, "NOT_FOUND");

  await TeacherCourseService.ensureInterviewFromFreePreviews(id);
  const readiness = await TeacherCourseService.getCourseReadiness(id);

  const whiteboardIds = [
    ...new Set(
      course.lessons
        .map((l) => l.whiteboardAssetId)
        .filter((wid): wid is string => Boolean(wid))
    ),
  ];
  const whiteboardAssets = whiteboardIds.length
    ? await prisma.whiteboardAsset.findMany({
        where: { id: { in: whiteboardIds } },
        select: { id: true, objectKey: true, durationSec: true, theme: true, processingStatus: true },
      })
    : [];
  const wbById = new Map(whiteboardAssets.map((a) => [a.id, a]));
  const wbPackageUrls = new Map<string, string>();
  await Promise.all(
    whiteboardAssets.map(async (a) => {
      try {
        wbPackageUrls.set(
          a.id,
          await getDownloadUrl(a.objectKey, WHITEBOARD_PLAYBACK_EXPIRES_SEC)
        );
      } catch {
        /* leave missing — player can still try /api/whiteboards/[id] */
      }
    })
  );

  const lessons = await Promise.all(
    course.lessons.map(async (l) => {
      const isWhiteboard = l.lessonType === "WHITEBOARD" || Boolean(l.whiteboardAssetId);
      const wb = l.whiteboardAssetId ? wbById.get(l.whiteboardAssetId) : null;
      let fileUrl: string | null = null;
      let packageUrl: string | null = null;

      if (isWhiteboard && l.whiteboardAssetId) {
        packageUrl = wbPackageUrls.get(l.whiteboardAssetId) ?? null;
        // Prefer the .ubrd package for audits; fall back to signed fileKey if present.
        fileUrl = packageUrl;
        if (!fileUrl && l.fileKey) {
          fileUrl = await getDownloadUrl(l.fileKey, WHITEBOARD_PLAYBACK_EXPIRES_SEC).catch(
            () => null
          );
          packageUrl = fileUrl;
        }
      } else if (l.fileKey) {
        fileUrl = await getDownloadUrl(l.fileKey).catch(() => null);
      }
      if (!fileUrl) fileUrl = l.fileUrl;

      const thumbnailUrl =
        (await resolvePublicMediaUrl(l.thumbnailUrl, l.thumbnailKey).catch(() => null)) ??
        l.thumbnailUrl;

      return {
        ...l,
        lessonType: isWhiteboard ? "WHITEBOARD" : l.lessonType ?? "VIDEO",
        fileUrl,
        thumbnailUrl,
        packageUrl,
        whiteboardId: l.whiteboardAssetId,
        whiteboardTheme: wb?.theme ?? null,
        whiteboardStatus: wb?.processingStatus ?? null,
      };
    })
  );

  const materials = await Promise.all(
    course.materials.map(async (m) => {
      let fileUrl = m.fileUrl;
      if (m.fileKey && !fileUrl) {
        fileUrl = await getDownloadUrl(m.fileKey).catch(() => null);
      } else if (m.fileKey) {
        fileUrl =
          (await resolvePublicMediaUrl(m.fileUrl, m.fileKey).catch(() => null)) ?? m.fileUrl;
      }
      return { ...m, fileUrl };
    })
  );

  return json({
    course: {
      ...course,
      thumbnail:
        (await resolvePublicMediaUrl(course.thumbnail, null).catch(() => null)) ??
        course.thumbnail,
      lessons,
      materials,
    },
    readiness,
  });
}
