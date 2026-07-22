import { prisma } from "@/lib/prisma";
import { withCache, CacheTTL } from "@/lib/prisma-cache";
import { json } from "@/lib/api";

export async function GET() {
  const countries = await prisma.country.findMany(
    withCache(
      {
        where: { isActive: true, deletedAt: null },
        include: {
          provinces: {
            where: { isActive: true, deletedAt: null },
            orderBy: { nameEn: "asc" as const },
          },
        },
        orderBy: { nameEn: "asc" as const },
      },
      CacheTTL.reference
    )
  );
  return json({ countries });
}
