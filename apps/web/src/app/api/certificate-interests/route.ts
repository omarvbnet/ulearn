import { json } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Public: areas of interest for certificate registration.
 * Subjects under the Professional Certificates (isCertificateTrack) stage.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const countryId = searchParams.get("countryId") ?? undefined;

  const stage = await prisma.educationalStage.findFirst({
    where: {
      isCertificateTrack: true,
      isActive: true,
      deletedAt: null,
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
      subjects: {
        where: { deletedAt: null, isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          nameKu: true,
          nameTr: true,
          sortOrder: true,
        },
      },
    },
  });

  return json({
    stage: stage
      ? {
          id: stage.id,
          countryId: stage.countryId,
          nameEn: stage.nameEn,
          nameAr: stage.nameAr,
          nameKu: stage.nameKu,
          nameTr: stage.nameTr,
        }
      : null,
    interests: stage?.subjects ?? [],
  });
}
