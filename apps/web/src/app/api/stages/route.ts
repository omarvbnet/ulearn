import { json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { CacheTTL } from "@/lib/prisma-cache";

/** Public: active educational stages (used at registration and for stage-change requests). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const countryId = searchParams.get("countryId") ?? undefined;

  const stages = await prisma.educationalStage.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      isCertificateTrack: false,
      ...(countryId ? { countryId } : {}),
    },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      countryId: true,
      nameEn: true,
      nameAr: true,
      nameKu: true,
      nameTr: true,
      isCertificateTrack: true,
    },
    cacheStrategy: CacheTTL.reference,
  });

  return json({ stages });
}
