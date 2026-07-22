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
  action: z.enum(["approve", "reject", "cancel"]),
});

/** Admin: confirm, reject, or cancel (revoke paid access) a course purchase. */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { purchaseId, action } = parsed.data;
  const actorId = auth.session.userId;

  const result =
    action === "approve"
      ? await TeacherCourseService.approvePurchase(purchaseId, actorId)
      : action === "cancel"
        ? await TeacherCourseService.cancelPurchase(purchaseId, actorId)
        : await TeacherCourseService.rejectPurchase(purchaseId, actorId);

  if (!result.success) return error(result.error, 400, result.error);
  return json(result);
}
