import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DeviceService } from "@/services/device.service";
import { LoggingService } from "@/services/logging.service";
import { z } from "zod";

const patchSchema = z.object({
  deviceLimit: z.number().int().min(1).max(20),
});

/** Admin: set how many devices this user may use concurrently. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, phone: true, deviceLimit: true },
  });
  if (!user) return error("User not found", 404, "NOT_FOUND");

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const updated = await DeviceService.setUserDeviceLimit(id, parsed.data.deviceLimit);

  await LoggingService.log({
    actorId: auth.session.userId,
    action: "USER_DEVICE_LIMIT_SET",
    entityType: "User",
    entityId: id,
    previousValue: { deviceLimit: user.deviceLimit },
    newValue: { deviceLimit: updated.deviceLimit },
  });

  const [activeCount, effectiveLimit] = await Promise.all([
    DeviceService.countActive(id),
    DeviceService.getDeviceLimit(id),
  ]);

  return json({
    user: updated,
    activeDeviceCount: activeCount,
    effectiveDeviceLimit: effectiveLimit,
  });
}

/** Admin: list devices for a user (optional management). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, deviceLimit: true },
  });
  if (!user) return error("User not found", 404, "NOT_FOUND");

  const [devices, effectiveLimit, activeCount] = await Promise.all([
    DeviceService.listDevices(id),
    DeviceService.getDeviceLimit(id),
    DeviceService.countActive(id),
  ]);

  return json({
    devices,
    deviceLimit: user.deviceLimit,
    effectiveDeviceLimit: effectiveLimit,
    activeDeviceCount: activeCount,
  });
}
