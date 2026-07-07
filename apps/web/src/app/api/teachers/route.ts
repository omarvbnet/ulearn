import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** List active teachers (for students to rate or reference in complaints). */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const teachers = await prisma.teacherProfile.findMany({
    where: { deletedAt: null, isActive: true },
    select: {
      id: true,
      bio: true,
      specializations: true,
      user: { select: { fullLegalName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return json({ teachers });
}
