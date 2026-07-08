import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

/** Admin: list teacher courses for review, filterable by status. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const courses = await prisma.course.findMany({
    where: { deletedAt: null, ...(status ? { status: status as never } : {}) },
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
      lessons: { select: { id: true, title: true, durationSec: true } },
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
