import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const countrySchema = z.object({
  code: z.string().min(2).max(4),
  nameEn: z.string().min(2),
  nameAr: z.string().min(2),
  nameKu: z.string().min(2),
  nameTr: z.string().min(2),
  isActive: z.boolean().optional(),
});

/** Admin: list countries with provinces. */
export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const countries = await prisma.country.findMany({
    where: { deletedAt: null },
    orderBy: { nameEn: "asc" },
    include: {
      provinces: {
        where: { deletedAt: null },
        orderBy: { nameEn: "asc" },
      },
      _count: { select: { educationalStages: true } },
    },
  });

  return json({ countries });
}

/** Admin: add a country. */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = countrySchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const existing = await prisma.country.findFirst({
    where: { code: parsed.data.code.toUpperCase(), deletedAt: null },
  });
  if (existing) return error("Country code already exists", 409, "DUPLICATE");

  const country = await prisma.country.create({
    data: { ...parsed.data, code: parsed.data.code.toUpperCase() },
  });

  return json({ country }, 201);
}
