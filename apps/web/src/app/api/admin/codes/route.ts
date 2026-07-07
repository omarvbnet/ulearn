import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { generateActivationCode } from "@/lib/utils";
import { LoggingService } from "@/services/logging.service";

export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const codes = await prisma.activationCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Resolve package names in one query.
  const packageIds = [...new Set(codes.map((c) => c.packageId).filter(Boolean))] as string[];
  const packages = await prisma.subscriptionPackage.findMany({
    where: { id: { in: packageIds } },
    select: { id: true, nameEn: true },
  });
  const nameOf = new Map(packages.map((p) => [p.id, p.nameEn]));

  return json({
    codes: codes.map((c) => ({
      ...c,
      packageName: c.packageId ? nameOf.get(c.packageId) ?? null : null,
    })),
  });
}

/** Generate standalone activation codes for a package (bulk supported). */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const { packageId, count, expiresInDays } = body as {
    packageId?: string;
    count?: number;
    expiresInDays?: number;
  };

  if (!packageId) return error("packageId is required", 422, "VALIDATION");

  const qty = Math.min(Math.max(1, count ?? 1), 100);
  const expiresAt = new Date(Date.now() + (expiresInDays ?? 30) * 24 * 60 * 60 * 1000);

  const created = await prisma.$transaction(
    Array.from({ length: qty }).map(() =>
      prisma.activationCode.create({
        data: {
          code: generateActivationCode(),
          packageId,
          createdById: auth.session.userId,
          expiresAt,
        },
      })
    )
  );

  await LoggingService.log({
    actorId: auth.session.userId,
    action: "GENERATE_ACTIVATION_CODES",
    entityType: "ActivationCode",
    newValue: { packageId, count: qty },
  });

  return json({ codes: created }, 201);
}
