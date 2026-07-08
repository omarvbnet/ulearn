import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

/** Admin: list pending lesson update requests on live courses. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") ?? "PENDING") as "PENDING" | "APPROVED" | "REJECTED";

  const requests = await prisma.courseLessonUpdateRequest.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      lesson: {
        select: {
          id: true,
          title: true,
          fileUrl: true,
          course: {
            select: {
              id: true,
              titleEn: true,
              teacher: {
                select: {
                  user: { select: { fullLegalName: true, phone: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  return json({ requests });
}
