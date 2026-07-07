import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

/** Admin: list complaints, filterable by status. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const complaints = await prisma.complaint.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      student: { select: { fullLegalName: true, phone: true } },
      teacher: { include: { user: { select: { fullLegalName: true } } } },
      handledBy: { select: { fullLegalName: true } },
    },
  });

  return json({ complaints });
}
