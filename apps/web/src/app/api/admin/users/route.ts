import { prisma } from "@/lib/prisma";
import { error, json, requireAuth } from "@/lib/api";

export async function GET(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const role = searchParams.get("role");
  const q = searchParams.get("q");
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const limit = Math.min(100, Number(searchParams.get("limit") || 20));

  const where = {
    deletedAt: null,
    ...(status ? { status: status as never } : {}),
    ...(role ? { role: role as never } : {}),
    ...(q
      ? {
          OR: [
            { fullLegalName: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" as const } },
            { nationalId: { contains: q } },
          ],
        }
      : {}),
    ...(auth.session.role === "COUNTRY_ADMIN"
      ? {
          countryId: (
            await prisma.user.findUnique({
              where: { id: auth.session.userId },
              select: { countryId: true },
            })
          )?.countryId ?? undefined,
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        country: true,
        province: true,
        studentProfile: true,
        certificateProfile: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return json({ users, total, page, limit });
}
