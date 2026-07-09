import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import type { ProductCategory } from "@prisma/client";
import { LoggingService } from "@/services/logging.service";
import { z } from "zod";

/** Admin: list all products. */
export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { _count: { select: { purchases: true } } },
  });

  return json({ products });
}

const createSchema = z.object({
  countryId: z.string().optional(),
  category: z.enum(["PINS", "BOOKS", "BOARDS", "SUPPLIES", "STATIONERY", "OTHER"]),
  nameEn: z.string().min(1),
  nameAr: z.string().optional(),
  nameKu: z.string().optional(),
  nameTr: z.string().optional(),
  descriptionEn: z.string().optional(),
  descriptionAr: z.string().optional(),
  descriptionKu: z.string().optional(),
  descriptionTr: z.string().optional(),
  price: z.number().positive(),
  currency: z.string().optional(),
  imageKey: z.string().optional(),
  imageUrl: z.string().min(1),
  images: z.array(z.string()).optional(),
  stock: z.number().int().min(0).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

/** Admin: create a product. */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const product = await prisma.product.create({
    data: {
      ...parsed.data,
      category: parsed.data.category as ProductCategory,
      stock: parsed.data.stock ?? null,
    },
  });

  await LoggingService.log({
    actorId: auth.session.userId,
    action: "PRODUCT_CREATE",
    entityType: "Product",
    entityId: product.id,
    newValue: product,
  });

  return json({ product }, 201);
}
