import { json, optionalAuth } from "@/lib/api";
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

/** Browse physical products (public). Order status when signed in. */
export async function GET(request: Request) {
  const session = await optionalAuth();

  const { searchParams } = new URL(request.url);
  const user = session
    ? await prisma.user.findUnique({
        where: { id: session.userId },
        select: { locale: true, countryId: true },
      })
    : null;
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
    session?.userId ?? "",
    locale
  );

  return json({ products, categories: [...categories] });
}
