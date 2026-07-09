import { error, json, requireAuth } from "@/lib/api";
import { ProductService } from "@/services/product.service";
import { z } from "zod";

const bodySchema = z.object({
  quantity: z.number().int().min(1).max(99).optional(),
  notes: z.string().max(500).optional(),
});

/** Students: request to buy a product (admin confirms payment offline). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER", "TEACHER"]);
  if (auth.error) return auth.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { id } = await params;
  const result = await ProductService.requestPurchase(id, auth.session.userId, parsed.data);
  if (!result.success) return error(result.error, 400, result.error);

  return json({ purchase: result.purchase }, 201);
}
