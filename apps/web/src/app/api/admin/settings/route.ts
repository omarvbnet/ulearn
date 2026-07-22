import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { LoggingService } from "@/services/logging.service";
import type { Prisma } from "@prisma/client";

export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const countryId = searchParams.get("countryId");

  const settings = await prisma.systemSetting.findMany({
    where: { countryId: countryId ?? null },
  });

  return json({ settings });
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const { key, value, countryId } = body as {
    key?: string;
    value?: unknown;
    countryId?: string | null;
  };

  if (!key || value === undefined) {
    return error("key and value are required", 422, "VALIDATION");
  }

  // Compound unique lookups reject null members, so resolve the row manually.
  const existing = await prisma.systemSetting.findFirst({
    where: { countryId: countryId ?? null, key },
  });

  const setting = existing
    ? await prisma.systemSetting.update({
        where: { id: existing.id },
        data: {
          value: value as Prisma.InputJsonValue,
          updatedBy: auth.session.userId,
        },
      })
    : await prisma.systemSetting.create({
        data: {
          key,
          value: value as Prisma.InputJsonValue,
          countryId: countryId ?? null,
          updatedBy: auth.session.userId,
        },
      });

  await LoggingService.log({
    actorId: auth.session.userId,
    action: "UPDATE_SETTING",
    entityType: "SystemSetting",
    entityId: setting.id,
    newValue: { key, value } as Prisma.InputJsonValue,
  });

  return json({ setting });
}
