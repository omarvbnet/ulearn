import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const provinceSchema = z.object({
  nameEn: z.string().min(2),
  nameAr: z.string().min(2),
  nameKu: z.string().min(2),
  nameTr: z.string().min(2),
  isActive: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

/** Admin: add a province to a country. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id: countryId } = await params;
  const country = await prisma.country.findFirst({
    where: { id: countryId, deletedAt: null },
  });
  if (!country) return error("Country not found", 404, "NOT_FOUND");

  const parsed = provinceSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const province = await prisma.province.create({
    data: { countryId, ...parsed.data },
  });

  return json({ province }, 201);
}
