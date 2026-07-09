import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import type { ProductCategory } from "@prisma/client";
import { LoggingService } from "@/services/logging.service";
import { z } from "zod";

const patchSchema = z.object({
  countryId: z.string().nullable().optional(),
  category: z.enum(["PINS", "BOOKS", "BOARDS", "SUPPLIES", "STATIONERY", "OTHER"]).optional(),
  nameEn: z.string().min(1).optional(),
  nameAr: z.string().nullable().optional(),
  nameKu: z.string().nullable().optional(),
  nameTr: z.string().nullable().optional(),
  descriptionEn: z.string().nullable().optional(),
  descriptionAr: z.string().nullable().optional(),
  descriptionKu: z.string().nullable().optional(),
  descriptionTr: z.string().nullable().optional(),
  price: z.number().positive().optional(),
  currency: z.string().optional(),
  imageKey: z.string().nullable().optional(),
  imageUrl: z.string().min(1).optional(),
  images: z.array(z.string()).optional(),
  stock: z.number().int().min(0).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

/** Admin: update a product. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { id } = await params;
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return error("Product not found", 404, "NOT_FOUND");

  const { category, ...rest } = parsed.data;
  const product = await prisma.product.update({
    where: { id },
    data: {
      ...rest,
      ...(category ? { category: category as ProductCategory } : {}),
    },
  });

  await LoggingService.log({
    actorId: auth.session.userId,
    action: "PRODUCT_UPDATE",
    entityType: "Product",
    entityId: product.id,
    previousValue: existing,
    newValue: product,
  });

  return json({ product });
}

/** Admin: soft-delete a product. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return error("Product not found", 404, "NOT_FOUND");

  await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await LoggingService.log({
    actorId: auth.session.userId,
    action: "PRODUCT_DELETE",
    entityType: "Product",
    entityId: id,
    previousValue: existing,
  });

  return json({ ok: true });
}
