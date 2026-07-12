import { json, optionalAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";

/** Browse published teacher courses (public). Purchase status when signed in.
 *  CERTIFICATE_USER: auto-filter to their insight subjectIds unless overridden.
 */
export async function GET(request: Request) {
  const session = await optionalAuth();

  const { searchParams } = new URL(request.url);
  const explicitStageId = searchParams.get("stageId") ?? undefined;
  const explicitSubjectId = searchParams.get("subjectId") ?? undefined;
  const explicitSubjectIds = searchParams.get("subjectIds")
    ? searchParams
        .get("subjectIds")!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  let stageId = explicitStageId;
  let subjectId = explicitSubjectId;
  let subjectIds = explicitSubjectIds;

  if (session?.userId && !explicitStageId && !explicitSubjectId && !explicitSubjectIds) {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        role: true,
        certificateProfile: {
          select: {
            interests: {
              select: {
                subjectId: true,
                subject: { select: { stageId: true } },
              },
            },
          },
        },
      },
    });
    if (user?.role === "CERTIFICATE_USER") {
      const interestIds =
        user.certificateProfile?.interests.map((i) => i.subjectId) ?? [];
      const certStageId =
        user.certificateProfile?.interests.find((i) => i.subject.stageId)?.subject
          .stageId ?? undefined;
      if (interestIds.length) {
        subjectIds = interestIds;
        stageId = certStageId;
      } else if (certStageId) {
        stageId = certStageId;
      }
    }
  }

  const courses = await TeacherCourseService.listPublishedCourses({
    stageId,
    subjectId,
    subjectIds: subjectId ? undefined : subjectIds,
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
