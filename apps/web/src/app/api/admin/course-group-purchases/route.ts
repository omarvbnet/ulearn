import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseGroupService } from "@/services/course-group.service";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const bodySchema = z.object({
  purchaseId: z.string().min(1),
  action: z.enum(["approve", "reject", "cancel"]),
});

export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const status = new URL(request.url).searchParams.get("status") ?? "PENDING";

  if (status === "PENDING") {
    const purchases = await CourseGroupService.listPendingPurchases();
    return json({ purchases });
  }

  const purchases = await prisma.courseGroupPurchase.findMany({
    where: status === "ALL" ? {} : { status: status as never },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { fullLegalName: true, phone: true } },
      group: {
        select: {
          titleEn: true,
          stage: { select: { nameEn: true } },
          items: { select: { courseId: true } },
        },
      },
    },
  });

  return json({ purchases });
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { purchaseId, action } = parsed.data;
  const actorId = auth.session.userId;

  const result =
    action === "approve"
      ? await CourseGroupService.approvePurchase(purchaseId, actorId)
      : action === "cancel"
        ? await CourseGroupService.cancelPurchase(purchaseId, actorId)
        : await CourseGroupService.rejectPurchase(purchaseId, actorId);

  if (!result.success) return error(result.error, 400, result.error);
  return json({ success: true });
}
