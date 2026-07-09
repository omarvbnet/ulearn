import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { ProductCategory } from "@prisma/client";
import { ProductService } from "@/services/product.service";

const categories = new Set([
  "PINS",
  "BOOKS",
  "BOARDS",
  "SUPPLIES",
  "STATIONERY",
  "OTHER",
]);

/** Students: browse physical products with filters. */
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const user = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: { locale: true, countryId: true },
  });
  const locale = user?.locale?.toLowerCase() ?? "en";

  const rawCategory = searchParams.get("category");
  const category =
    rawCategory && categories.has(rawCategory) ? (rawCategory as ProductCategory) : undefined;

  const minPrice = searchParams.get("minPrice");
  const maxPrice = searchParams.get("maxPrice");
  const sort = searchParams.get("sort") as "newest" | "price_asc" | "price_desc" | "popular" | null;

  const products = await ProductService.listForStore(
    {
      category,
      q: searchParams.get("q") ?? undefined,
      minPrice: minPrice != null && minPrice !== "" ? Number(minPrice) : undefined,
      maxPrice: maxPrice != null && maxPrice !== "" ? Number(maxPrice) : undefined,
      sort: sort ?? undefined,
      countryId: user?.countryId ?? undefined,
    },
    auth.session.userId,
    locale
  );

  return json({ products, categories: [...categories] });
}
