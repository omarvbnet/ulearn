import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { z } from "zod";

/** Admin: list course purchase requests. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "PENDING";

  const purchases = await prisma.coursePurchase.findMany({
    where: status === "ALL" ? {} : { status: status as never },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { fullLegalName: true, phone: true } },
      course: {
        select: {
          titleEn: true,
          price: true,
          currency: true,
          teacher: {
            select: { level: true, user: { select: { fullLegalName: true } } },
          },
        },
      },
    },
  });

  return json({ purchases });
}

const actionSchema = z.object({
  purchaseId: z.string(),
  action: z.enum(["approve", "reject"]),
});

/** Admin: confirm (payment received) or reject a purchase request. */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result =
    parsed.data.action === "approve"
      ? await TeacherCourseService.approvePurchase(
          parsed.data.purchaseId,
          auth.session.userId
        )
      : await TeacherCourseService.rejectPurchase(
          parsed.data.purchaseId,
          auth.session.userId
        );

  if (!result.success) return error(result.error, 400, result.error);
  return json(result);
}
