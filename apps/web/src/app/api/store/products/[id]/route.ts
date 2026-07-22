import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ProductService } from "@/services/product.service";

/** Students: product detail. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: { locale: true },
  });
  const locale = user?.locale?.toLowerCase() ?? "en";

  const product = await ProductService.getForStore(id, auth.session.userId, locale);
  if (!product) return error("Product not found", 404, "NOT_FOUND");

  return json({ product });
}
