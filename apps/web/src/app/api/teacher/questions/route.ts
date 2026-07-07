import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { STAFF_ROLES } from "@/lib/auth/session";

export async function GET(request: Request) {
  const auth = await requireAuth(STAFF_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") ?? "open";

  const questions = await prisma.lessonQuestion.findMany({
    where: {
      deletedAt: null,
      ...(filter === "open" ? { isResolved: false } : {}),
      ...(filter === "resolved" ? { isResolved: true } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      student: { select: { id: true, fullLegalName: true } },
      lesson: {
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          nameKu: true,
          nameTr: true,
          chapter: {
            select: {
              subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true } },
            },
          },
        },
      },
      answers: {
        orderBy: { createdAt: "asc" },
        include: { teacher: { select: { id: true, fullLegalName: true } } },
      },
    },
  });

  return json({ questions });
}
