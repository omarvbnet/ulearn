import { prisma } from "@/lib/prisma";
import { json } from "@/lib/api";

export async function GET() {
  const countries = await prisma.country.findMany({
    where: { isActive: true, deletedAt: null },
    include: {
      provinces: {
        where: { isActive: true, deletedAt: null },
        orderBy: { nameEn: "asc" },
      },
    },
    orderBy: { nameEn: "asc" },
  });
  return json({ countries });
}
