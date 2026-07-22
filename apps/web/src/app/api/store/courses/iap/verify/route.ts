import { error, json, requireAuth } from "@/lib/api";
import { CourseIapService } from "@/services/course-iap.service";
import { z } from "zod";

const schema = z.object({
  courseId: z.string().min(1).optional(),
  platform: z.enum(["APPLE", "GOOGLE"]),
  productId: z.string().min(1).max(200),
  transactionId: z.string().min(1).max(200),
  purchaseToken: z.string().min(1).max(8000),
  receiptData: z.string().max(200_000).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await CourseIapService.verifyAndActivate({
      userId: auth.session.userId,
      ...parsed.data,
    });
    return json({
      ok: true,
      alreadyProcessed: result.alreadyProcessed,
      purchaseId: result.purchase.id,
      courseId: result.purchase.courseId,
      expiresAt: result.purchase.expiresAt,
      status: result.purchase.status,
    });
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Course IAP failed",
      402,
      "COURSE_IAP_FAILED"
    );
  }
}
