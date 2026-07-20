import { json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { withCache, CacheTTL } from "@/lib/prisma-cache";

/** Public: active educational stages (used at registration and for stage-change requests). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const countryId = searchParams.get("countryId") ?? undefined;

  const stages = await prisma.educationalStage.findMany(
    withCache(
      {
        where: {
          isActive: true,
          deletedAt: null,
          isCertificateTrack: false,
          ...(countryId ? { countryId } : {}),
        },
        orderBy: { sortOrder: "asc" as const },
        select: {
          id: true,
          countryId: true,
          nameEn: true,
          nameAr: true,
          nameKu: true,
          nameTr: true,
          isCertificateTrack: true,
        },
      },
      CacheTTL.reference
    )
  );

  return json({ stages });
}
