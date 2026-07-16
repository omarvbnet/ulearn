import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getDownloadUrl, resolvePublicMediaUrl } from "@/lib/r2";
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
      },      _count: {
        select: {
          purchases: { where: { status: "PAID" } },
        },
      },
    },
  });

  if (!course) return error("Course not found", 404, "NOT_FOUND");

  await TeacherCourseService.ensureInterviewFromFreePreviews(id);
  const readiness = await TeacherCourseService.getCourseReadiness(id);

  const lessons = await Promise.all(
    course.lessons.map(async (l) => {
      let fileUrl: string | null = null;
      if (l.fileKey) {
        fileUrl = await getDownloadUrl(l.fileKey).catch(() => null);
      }
      if (!fileUrl) fileUrl = l.fileUrl;
      const thumbnailUrl =
        (await resolvePublicMediaUrl(l.thumbnailUrl, l.thumbnailKey).catch(() => null)) ??
        l.thumbnailUrl;
      return { ...l, fileUrl, thumbnailUrl };
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
