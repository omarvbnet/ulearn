import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ProductService } from "@/services/product.service";
import { z } from "zod";

/** Admin: list product purchase requests. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "PENDING";

  const purchases = await prisma.productPurchase.findMany({
    where: status === "ALL" ? {} : { status: status as never },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: {
        select: {
          fullLegalName: true,
          phone: true,
          email: true,
          locationLabel: true,
          province: { select: { nameEn: true, nameAr: true } },
          country: { select: { nameEn: true, nameAr: true } },
        },
      },
      product: {
        select: {
          nameEn: true,
          nameAr: true,
          category: true,
          imageUrl: true,
          price: true,
          currency: true,
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

/** Admin: confirm or reject a product order request. */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result =
    parsed.data.action === "approve"
      ? await ProductService.approvePurchase(parsed.data.purchaseId, auth.session.userId)
      : await ProductService.rejectPurchase(parsed.data.purchaseId, auth.session.userId);

  if (!result.success) return error(result.error, 400, result.error);
  return json(result);
}
