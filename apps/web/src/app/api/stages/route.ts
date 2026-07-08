import { json } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Public: active educational stages (used at registration and for stage-change requests). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const countryId = searchParams.get("countryId") ?? undefined;

  const stages = await prisma.educationalStage.findMany({
    where: { isActive: true, deletedAt: null, ...(countryId ? { countryId } : {}) },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      countryId: true,
      nameEn: true,
      nameAr: true,
      nameKu: true,
      nameTr: true,
    },
  });

  return json({ stages });
}
