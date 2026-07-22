import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({
  code: z.string().min(2).max(4).optional(),
  nameEn: z.string().min(2).optional(),
  nameAr: z.string().min(2).optional(),
  nameKu: z.string().min(2).optional(),
  nameTr: z.string().min(2).optional(),
  isActive: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

/** Admin: update a country. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const data = { ...parsed.data };
  if (data.code) data.code = data.code.toUpperCase();

  const country = await prisma.country.update({
    where: { id },
    data,
  });

  return json({ country });
}

/** Admin: soft-delete a country. */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  await prisma.country.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  return json({ ok: true });
}
