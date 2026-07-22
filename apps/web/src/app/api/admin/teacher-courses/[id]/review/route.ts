import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { NextResponse } from "next/server";

/** Admin: approve or reject a teacher course. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const { decision, notes, accessMonths, appleProductId, googleProductId } =
    (await request.json()) as {
      decision?: "APPROVED" | "REJECTED";
      notes?: string;
      accessMonths?: number;
      appleProductId?: string | null;
      googleProductId?: string | null;
    };

  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return error("decision must be APPROVED or REJECTED", 422, "VALIDATION");
  }

  const result = await TeacherCourseService.reviewCourse(
    id,
    auth.session.userId,
    decision,
    notes,
    { accessMonths, appleProductId, googleProductId }
  );
  if (!result.success) {
    if (result.error === "NOT_READY" && "readiness" in result) {
      return NextResponse.json(
        {
          error: "Course is missing required content",
          code: "NOT_READY",
          readiness: result.readiness,
        },
        { status: 422 }
      );
    }
    if (result.error === "TEACHER_BLOCKED") {
      return error("Teacher account is blocked", 400, "TEACHER_BLOCKED");
    }
    return error(result.error, 400, result.error);
  }

  return json({ course: result.course });
}
