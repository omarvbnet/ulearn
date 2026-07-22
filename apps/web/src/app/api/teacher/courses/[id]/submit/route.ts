import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { isAdminRole, TEACHER_COURSE_ROLES } from "@/lib/teacher-course-access";
import { NextResponse } from "next/server";

/** Teacher or admin: submit a DRAFT or REJECTED course for admin review. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;

  let teacherId: string;
  if (isAdminRole(auth.session.role)) {
    const course = await prisma.course.findFirst({
      where: { id, deletedAt: null },
      select: { teacherId: true },
    });
    if (!course) return error("Course not found", 404, "NOT_FOUND");
    teacherId = course.teacherId;
  } else {
    const teacher = await prisma.teacherProfile.findFirst({
      where: { userId: auth.session.userId, deletedAt: null },
      select: { id: true },
    });
    if (!teacher) return error("Teacher profile not found", 404, "NOT_FOUND");
    teacherId = teacher.id;
  }

  const result = await TeacherCourseService.submitForReview(id, teacherId);

  if (!result.success) {
    if (result.error === "NOT_FOUND") return error("Course not found", 404, "NOT_FOUND");
    if (result.error === "INVALID_STATUS") {
      return error("Only draft or rejected courses can be submitted", 400, "INVALID_STATUS");
    }
    if (result.error === "NOT_READY") {
      return NextResponse.json(
        { error: "Course is not ready for review", code: "NOT_READY", readiness: result.readiness },
        { status: 400 }
      );
    }
    return error("Submit failed", 400, "SUBMIT_FAILED");
  }

  return json({ course: result.course, readiness: result.readiness });
}
