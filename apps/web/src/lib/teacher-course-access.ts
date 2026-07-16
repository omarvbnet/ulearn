import { prisma } from "@/lib/prisma";
import type { Course, Prisma } from "@prisma/client";

export const TEACHER_COURSE_ROLES = [
  "TEACHER",
  "SUPER_ADMIN",
  "COUNTRY_ADMIN",
] as const;

export function isAdminRole(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "COUNTRY_ADMIN";
}

export function editableCourseWhere(
  userId: string,
  role: string,
  courseId: string
): Prisma.CourseWhereInput {
  if (isAdminRole(role)) {
    return { id: courseId, deletedAt: null };
  }
  return {
    id: courseId,
    deletedAt: null,
    teacher: { userId, deletedAt: null },
  };
}

export async function findEditableCourse(
  userId: string,
  role: string,
  courseId: string,
  select?: Prisma.CourseSelect
) {
  return prisma.course.findFirst({
    where: editableCourseWhere(userId, role, courseId),
    ...(select ? { select } : {}),
  });
}

export async function findEditableCourseFull(
  userId: string,
  role: string,
  courseId: string
): Promise<Course | null> {
  return findEditableCourse(userId, role, courseId) as Promise<Course | null>;
}
