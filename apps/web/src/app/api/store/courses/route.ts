import { json, optionalAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";

/** Browse published teacher courses (public). Purchase status when signed in. */
export async function GET(request: Request) {
  const session = await optionalAuth();

  const { searchParams } = new URL(request.url);
  const courses = await TeacherCourseService.listPublishedCourses({
    stageId: searchParams.get("stageId") ?? undefined,
    subjectId: searchParams.get("subjectId") ?? undefined,
  });

  const purchases = session
    ? await prisma.coursePurchase.findMany({
        where: { userId: session.userId },
        select: { courseId: true, status: true },
      })
    : [];
  const byCourse = new Map(purchases.map((p) => [p.courseId, p.status]));

  const enriched = await TeacherCourseService.enrichCoursesForUser(
    courses,
    session?.userId
  );

  return json({
    courses: enriched.map((c) => ({
      ...c,
      purchaseStatus: byCourse.get(c.id) ?? c.purchaseStatus ?? null,
    })),
  });
}
