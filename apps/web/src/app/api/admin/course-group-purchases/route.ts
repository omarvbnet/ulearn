import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseGroupService } from "@/services/course-group.service";
import { z } from "zod";

const bodySchema = z.object({
  purchaseId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
});

export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;
  const purchases = await CourseGroupService.listPendingPurchases();
  return json({ purchases });
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result =
    parsed.data.action === "approve"
      ? await CourseGroupService.approvePurchase(
          parsed.data.purchaseId,
          auth.session.userId
        )
      : await CourseGroupService.rejectPurchase(
          parsed.data.purchaseId,
          auth.session.userId
        );

  if (!result.success) return error(result.error, 400, result.error);
  return json({ success: true });
}
