import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({
  nameEn: z.string().min(2).optional(),
  nameAr: z.string().min(2).optional(),
  nameKu: z.string().min(2).optional(),
  nameTr: z.string().min(2).optional(),
  isActive: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

/** Admin: update a province. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const province = await prisma.province.update({
    where: { id },
    data: parsed.data,
  });

  return json({ province });
}

/** Admin: soft-delete a province. */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  await prisma.province.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  return json({ ok: true });
}
