import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { LoggingService } from "@/services/logging.service";

export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const packages = await prisma.subscriptionPackage.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      country: { select: { nameEn: true } },
      subject: { select: { nameEn: true } },
      stage: { select: { nameEn: true } },
      _count: { select: { subscriptions: true } },
    },
  });

  return json({ packages });
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const {
    countryId, type, nameEn, nameAr, nameKu, nameTr,
    description, price, currency, durationDays, deviceLimit, subjectId, stageId,
  } = body;

  if (!countryId || !type || !nameEn || price === undefined) {
    return error("countryId, type, nameEn, and price are required", 422, "VALIDATION");
  }

  const pkg = await prisma.subscriptionPackage.create({
    data: {
      countryId,
      type,
      nameEn,
      nameAr: nameAr || nameEn,
      nameKu: nameKu || nameEn,
      nameTr: nameTr || nameEn,
      description,
      price,
      currency: currency || "IQD",
      durationDays: durationDays || null,
      deviceLimit: deviceLimit ?? 1,
      subjectId: subjectId || null,
      stageId: stageId || null,
    },
  });

  await LoggingService.log({
    actorId: auth.session.userId,
    action: "CREATE_PACKAGE",
    entityType: "SubscriptionPackage",
    entityId: pkg.id,
    newValue: { nameEn, type, price },
  });

  return json({ package: pkg }, 201);
}
