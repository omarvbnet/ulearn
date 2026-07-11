import type { Prisma, ProductCategory, PurchaseStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ProductListFilters = {
  category?: ProductCategory;
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: "newest" | "price_asc" | "price_desc" | "popular";
  countryId?: string;
};

const nameFields = ["nameEn", "nameAr", "nameKu", "nameTr"] as const;
const descFields = ["descriptionEn", "descriptionAr", "descriptionKu", "descriptionTr"] as const;

function localizedPick<T extends Record<string, unknown>>(
  item: T,
  locale: string,
  prefix: "name" | "description"
): string {
  const fields =
    prefix === "name"
      ? (["En", "Ar", "Ku", "Tr"] as const).map((s) => `${prefix}${s}`)
      : (["En", "Ar", "Ku", "Tr"] as const).map((s) => `${prefix}${s}`);
  const prefer = locale.toUpperCase() === "AR" ? "Ar" : locale.toUpperCase() === "KU" ? "Ku" : locale.toUpperCase() === "TR" ? "Tr" : "En";
  const ordered = [prefer, "En", "Ar", "Ku", "Tr"];
  for (const suffix of ordered) {
    const key = `${prefix}${suffix}`;
    const val = item[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return "";
}

/** Admin + student product catalog. */
export class ProductService {
  static localize(product: Record<string, unknown>, locale: string) {
    return {
      ...product,
      name: localizedPick(product, locale, "name"),
      description: localizedPick(product, locale, "description"),
    };
  }

  static buildWhere(filters: ProductListFilters, activeOnly = true): Prisma.ProductWhereInput {
    const and: Prisma.ProductWhereInput[] = [{ deletedAt: null }];
    if (activeOnly) and.push({ isActive: true });
    if (filters.countryId) {
      and.push({ OR: [{ countryId: filters.countryId }, { countryId: null }] });
    }
    if (filters.category) and.push({ category: filters.category });
    if (filters.minPrice != null || filters.maxPrice != null) {
      and.push({
        price: {
          ...(filters.minPrice != null ? { gte: filters.minPrice } : {}),
          ...(filters.maxPrice != null ? { lte: filters.maxPrice } : {}),
        },
      });
    }
    if (filters.q?.trim()) {
      const q = filters.q.trim();
      and.push({
        OR: [
          ...nameFields.map((f) => ({ [f]: { contains: q, mode: "insensitive" as const } })),
          ...descFields.map((f) => ({ [f]: { contains: q, mode: "insensitive" as const } })),
        ],
      });
    }
    return { AND: and };
  }

  static orderBy(sort?: ProductListFilters["sort"]): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case "price_asc":
        return [{ price: "asc" }, { sortOrder: "asc" }];
      case "price_desc":
        return [{ price: "desc" }, { sortOrder: "asc" }];
      case "popular":
        return [{ purchases: { _count: "desc" } }, { sortOrder: "asc" }];
      case "newest":
      default:
        return [{ createdAt: "desc" }, { sortOrder: "asc" }];
    }
  }

  static async listForStore(filters: ProductListFilters, userId: string, locale: string) {
    const products = await prisma.product.findMany({
      where: this.buildWhere(filters, true),
      orderBy: this.orderBy(filters.sort),
      take: 100,
      include: {
        _count: { select: { purchases: { where: { status: "PAID" } } } },
      },
    });

    const purchases = userId
      ? await prisma.productPurchase.findMany({
          where: { userId, productId: { in: products.map((p) => p.id) } },
          select: { productId: true, status: true, quantity: true },
        })
      : [];
    const byProduct = new Map(purchases.map((p) => [p.productId, p]));

    return products.map((p) => {
      const purchase = byProduct.get(p.id);
      return {
        ...this.localize(p, locale),
        purchaseCount: p._count.purchases,
        purchaseStatus: purchase?.status ?? null,
        orderedQuantity: purchase?.quantity ?? null,
      };
    });
  }

  static async getForStore(id: string, userId: string, locale: string) {
    const product = await prisma.product.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: { _count: { select: { purchases: { where: { status: "PAID" } } } } },
    });
    if (!product) return null;

    const purchase = await prisma.productPurchase.findUnique({
      where: { productId_userId: { productId: id, userId } },
      select: { status: true, quantity: true, notes: true },
    });

    return {
      ...this.localize(product, locale),
      purchaseCount: product._count.purchases,
      purchaseStatus: purchase?.status ?? null,
      orderedQuantity: purchase?.quantity ?? null,
      orderNotes: purchase?.notes ?? null,
    };
  }

  static async requestPurchase(
    productId: string,
    userId: string,
    input: { quantity?: number; notes?: string }
  ) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null, isActive: true },
    });
    if (!product) return { success: false as const, error: "PRODUCT_NOT_AVAILABLE" };

    const quantity = Math.max(1, Math.min(99, input.quantity ?? 1));
    if (product.stock != null && product.stock < quantity) {
      return { success: false as const, error: "OUT_OF_STOCK" };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        fullLegalName: true,
        phone: true,
        locationLabel: true,
        province: { select: { nameEn: true } },
        country: { select: { nameEn: true } },
      },
    });
    if (!user) return { success: false as const, error: "USER_NOT_FOUND" };

    const location =
      user.locationLabel ??
      ([user.province?.nameEn, user.country?.nameEn].filter(Boolean).join(", ") || null);

    const existing = await prisma.productPurchase.findUnique({
      where: { productId_userId: { productId, userId } },
    });
    if (existing && existing.status !== "REJECTED") {
      return { success: false as const, error: "ALREADY_REQUESTED" };
    }

    const totalPrice = product.price * quantity;
    const data = {
      quantity,
      unitPrice: product.price,
      totalPrice,
      currency: product.currency,
      status: "PENDING" as PurchaseStatus,
      notes: input.notes?.trim() || null,
      userPhone: user.phone,
      userName: user.fullLegalName,
      userLocation: location,
      productName: product.nameEn,
      productImage: product.imageUrl,
    };

    const purchase = existing
      ? await prisma.productPurchase.update({ where: { id: existing.id }, data })
      : await prisma.productPurchase.create({
          data: { productId, userId, ...data },
        });

    return { success: true as const, purchase };
  }

  static async approvePurchase(purchaseId: string, actorId: string) {
    const purchase = await prisma.productPurchase.findUnique({
      where: { id: purchaseId },
      include: { product: true },
    });
    if (!purchase || purchase.status !== "PENDING") {
      return { success: false as const, error: "INVALID_PURCHASE" };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.productPurchase.update({
        where: { id: purchaseId },
        data: { status: "PAID", approvedById: actorId, approvedAt: new Date() },
      });
      if (purchase.product.stock != null) {
        await tx.product.update({
          where: { id: purchase.productId },
          data: { stock: { decrement: purchase.quantity } },
        });
      }
      return p;
    });

    return { success: true as const, purchase: updated };
  }

  static async rejectPurchase(purchaseId: string, actorId: string) {
    const purchase = await prisma.productPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.status !== "PENDING") {
      return { success: false as const, error: "INVALID_PURCHASE" };
    }

    const updated = await prisma.productPurchase.update({
      where: { id: purchaseId },
      data: { status: "REJECTED", approvedById: actorId, approvedAt: new Date() },
    });
    return { success: true as const, purchase: updated };
  }
}
