import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import {
  findEditableCourse,
  isAdminRole,
  TEACHER_COURSE_ROLES,
} from "@/lib/teacher-course-access";

async function teacherProfileId(userId: string) {
  const p = await prisma.teacherProfile.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true },
  });
  return p?.id;
}

/** Teacher or admin: get course for editing. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const isAdmin = isAdminRole(auth.session.role);
  let teacherId: string | undefined;
  if (!isAdmin) {
    teacherId = (await teacherProfileId(auth.session.userId)) ?? undefined;
    if (!teacherId) return error("Teacher profile not found", 404, "NOT_FOUND");
  }

  const course = await prisma.course.findFirst({
    where: isAdmin
      ? { id, deletedAt: null }
      : { id, deletedAt: null, teacherId },
    include: {
      stage: { select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
      subject: { select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
      lessons: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          materials: {
            where: { deletedAt: null },
            select: {
              id: true,
              title: true,
              type: true,
              fileKey: true,
              fileUrl: true,
              mimeType: true,
              fileSize: true,
              lessonId: true,
            },
          },
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
          fileSize: true,
          lessonId: true,
        },
      },
      quizzes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: {
          questions: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
        },
      },
      sections: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, sortOrder: true },
      },
      _count: {
        select: {
          purchases: { where: { status: "PAID" } },
          quizzes: { where: { deletedAt: null } },
        },
      },
    },
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  return json({ course: TeacherCourseService.formatTeacherCourse(course) });
}

/** Teacher or admin: update course metadata (cover, title, price, etc.). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await request.json();

  if (isAdminRole(auth.session.role)) {
    const exists = await findEditableCourse(auth.session.userId, auth.session.role, id);
    if (!exists) return error("Course not found", 404, "NOT_FOUND");
    const result = await TeacherCourseService.updateCourseAsAdmin(id, body);
    if (!result.success) return error(result.error, 400, result.error);
    return json({ course: result.course });
  }

  const profileId = await teacherProfileId(auth.session.userId);
  if (!profileId) return error("Teacher profile not found", 404, "NOT_FOUND");

  const result = await TeacherCourseService.updateCourse(profileId, id, body);
  if (!result.success) return error(result.error, 400, result.error);

  return json({ course: result.course });
}

/** Teacher or admin: delete course. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;

  if (isAdminRole(auth.session.role)) {
    const result = await TeacherCourseService.deleteCourseAsAdmin(id);
    if (!result.success) return error(result.error, 404, result.error);
    return json({ success: true });
  }

  const profileId = await teacherProfileId(auth.session.userId);
  if (!profileId) return error("Teacher profile not found", 404, "NOT_FOUND");

  const result = await TeacherCourseService.deleteCourse(profileId, id);
  if (!result.success) return error(result.error, 404, result.error);

  return json({ success: true });
}
