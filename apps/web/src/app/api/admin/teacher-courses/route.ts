import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import type { CourseStatus } from "@prisma/client";

const COURSE_STATUSES = new Set<CourseStatus>([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "CLOSED",
]);

/** Admin: list teacher courses for review, filterable by status. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  // Tab ids like COURSE_VIDEOS / VIDEO_UPDATES / PURCHASES must never hit Prisma.
  const status =
    statusParam && COURSE_STATUSES.has(statusParam as CourseStatus)
      ? (statusParam as CourseStatus)
      : null;

  if (statusParam && !status) {
    return json({ courses: [] });
  }

  const courses = await prisma.course.findMany({
    where: { deletedAt: null, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      teacher: {
        select: {
          id: true,
          level: true,
          isActive: true,
          user: { select: { fullLegalName: true, phone: true } },
        },
      },
      stage: { select: { nameEn: true } },
      subject: { select: { nameEn: true } },
      lessons: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          durationSec: true,
          isFreePreview: true,
          isInterview: true,
          sortOrder: true,
        },
      },
      materials: {
        where: { deletedAt: null },
        select: { id: true },
      },
      _count: {
        select: {
          purchases: { where: { status: "PAID" } },
          quizzes: { where: { deletedAt: null } },
        },
      },
    },
  });

  return json({ courses });
}
