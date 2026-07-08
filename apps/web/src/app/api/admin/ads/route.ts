import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

/** Admin: list all advertisements. */
export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const ads = await prisma.advertisement.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { likes: true } } },
  });

  return json({ ads });
}

const createSchema = z.object({
  titleEn: z.string().optional(),
  titleAr: z.string().optional(),
  titleKu: z.string().optional(),
  titleTr: z.string().optional(),
  imageKey: z.string().optional(),
  imageUrl: z.string().min(1),
  linkUrl: z.string().optional(),
  countryId: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});

/** Admin: create an advertisement. */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  const { startsAt, endsAt, ...rest } = parsed.data;

  const ad = await prisma.advertisement.create({
    data: {
      ...rest,
      startsAt: startsAt ? new Date(startsAt) : undefined,
      endsAt: endsAt ? new Date(endsAt) : undefined,
    },
  });

  return json({ ad }, 201);
}
