import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { LoggingService } from "@/services/logging.service";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await request.json();
  const {
    nameEn, nameAr, nameKu, nameTr, description,
    price, currency, durationDays, deviceLimit, isActive,
  } = body;

  const pkg = await prisma.subscriptionPackage.update({
    where: { id },
    data: {
      nameEn, nameAr, nameKu, nameTr, description,
      price, currency, durationDays, deviceLimit, isActive,
    },
  });

  return json({ package: pkg });
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  await prisma.subscriptionPackage.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await LoggingService.log({
    actorId: auth.session.userId,
    action: "DELETE_PACKAGE",
    entityType: "SubscriptionPackage",
    entityId: id,
  });

  return json({ ok: true });
}
