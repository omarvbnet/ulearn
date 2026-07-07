import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";

/** Full course tree for the admin course manager (includes inactive items). */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const countryId = searchParams.get("countryId") ?? undefined;

  const stages = await prisma.educationalStage.findMany({
    where: { deletedAt: null, ...(countryId ? { countryId } : {}) },
    orderBy: { sortOrder: "asc" },
    include: {
      country: { select: { id: true, nameEn: true, code: true } },
      subjects: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          chapters: {
            where: { deletedAt: null },
            orderBy: { sortOrder: "asc" },
            include: {
              lessons: {
                where: { deletedAt: null },
                orderBy: { sortOrder: "asc" },
                include: {
                  contents: {
                    where: { deletedAt: null },
                    orderBy: { sortOrder: "asc" },
                  },
                  quizzes: {
                    where: { deletedAt: null },
                    select: { id: true, titleEn: true, isActive: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const orphanSubjects = await prisma.subject.findMany({
    where: { deletedAt: null, stageId: null, ...(countryId ? { countryId } : {}) },
    orderBy: { sortOrder: "asc" },
    include: {
      chapters: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          lessons: {
            where: { deletedAt: null },
            orderBy: { sortOrder: "asc" },
            include: {
              contents: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
              quizzes: {
                where: { deletedAt: null },
                select: { id: true, titleEn: true, isActive: true },
              },
            },
          },
        },
      },
    },
  });

  return json({ stages, orphanSubjects });
}
