import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { getDownloadUrl } from "@/lib/r2";

/** Students: course detail; lesson media only after a confirmed purchase. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await prisma.course.findFirst({
    where: { id, status: "APPROVED", deletedAt: null },
    include: {
      teacher: {
        select: { id: true, level: true, user: { select: { fullLegalName: true } } },
      },
      stage: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
      subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
      lessons: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const purchased = await TeacherCourseService.hasPurchased(id, auth.session.userId);

  const lessons = await Promise.all(
    course.lessons.map(async (l) => {
      const canWatch = purchased || l.isFreePreview;
      let fileUrl = canWatch ? l.fileUrl : null;
      if (canWatch && l.fileKey && !fileUrl) {
        fileUrl = await getDownloadUrl(l.fileKey).catch(() => null);
      }
      return { ...l, fileKey: undefined, fileUrl };
    })
  );

  return json({ course: { ...course, lessons }, purchased });
}
