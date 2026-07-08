import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({
  titleEn: z.string().nullish(),
  titleAr: z.string().nullish(),
  titleKu: z.string().nullish(),
  titleTr: z.string().nullish(),
  imageKey: z.string().optional(),
  imageUrl: z.string().optional(),
  linkUrl: z.string().nullish(),
  countryId: z.string().nullish(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
});

/** Admin: update an advertisement. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  const { startsAt, endsAt, ...rest } = parsed.data;

  try {
    const ad = await prisma.advertisement.update({
      where: { id },
      data: {
        ...rest,
        startsAt: startsAt === undefined ? undefined : startsAt ? new Date(startsAt) : null,
        endsAt: endsAt === undefined ? undefined : endsAt ? new Date(endsAt) : null,
      },
    });
    return json({ ad });
  } catch {
    return error("Advertisement not found", 404, "NOT_FOUND");
  }
}

/** Admin: soft-delete an advertisement. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    await prisma.advertisement.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return json({ success: true });
  } catch {
    return error("Advertisement not found", 404, "NOT_FOUND");
  }
}
