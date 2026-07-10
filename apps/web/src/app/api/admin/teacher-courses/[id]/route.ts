import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";
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
      lessons: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          fileKey: true,
          fileUrl: true,
          thumbnailUrl: true,
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

  const lessons = await Promise.all(
    course.lessons.map(async (l) => {
      let fileUrl = l.fileUrl;
      if (l.fileKey && !fileUrl) {
        fileUrl = await getDownloadUrl(l.fileKey).catch(() => null);
      }
      return { ...l, fileUrl };
    })
  );

  const materials = await Promise.all(
    course.materials.map(async (m) => {
      let fileUrl = m.fileUrl;
      if (m.fileKey && !fileUrl) {
        fileUrl = await getDownloadUrl(m.fileKey).catch(() => null);
      }
      return { ...m, fileUrl };
    })
  );

  return json({
    course: { ...course, lessons, materials },
    readiness,
  });
}
