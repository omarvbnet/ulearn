import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";

/** Students: browse published teacher courses (with own purchase status). */
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const courses = await TeacherCourseService.listPublishedCourses({
    stageId: searchParams.get("stageId") ?? undefined,
    subjectId: searchParams.get("subjectId") ?? undefined,
  });

  const purchases = await prisma.coursePurchase.findMany({
    where: { userId: auth.session.userId },
    select: { courseId: true, status: true },
  });
  const byCourse = new Map(purchases.map((p) => [p.courseId, p.status]));

  const enriched = await TeacherCourseService.enrichCoursesForUser(
    courses,
    auth.session.userId
  );

  return json({
    courses: enriched.map((c) => ({
      ...c,
      purchaseStatus: byCourse.get(c.id) ?? c.purchaseStatus ?? null,
    })),
  });
}
