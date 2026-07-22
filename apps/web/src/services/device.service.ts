import { prisma } from "@/lib/prisma";

/**
 * Device registration and limit enforcement.
 * Effective limit = max(user.deviceLimit, highest active subscription deviceLimit), at least 1.
 * Admin can raise `User.deviceLimit` on the Users page (e.g. App Review demo account).
 */
export class DeviceService {
  static async getDeviceLimit(userId: string): Promise<number> {
    const [user, subs] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { deviceLimit: true },
      }),
      prisma.subscription.findMany({
        where: {
          userId,
          status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { deviceLimit: true },
      }),
    ]);

    const fromUser = user?.deviceLimit ?? 1;
    const fromSubs = subs.length
      ? Math.max(...subs.map((s) => s.deviceLimit))
      : 1;
    return Math.max(1, fromUser, fromSubs);
  }

  /**
   * Registers (or touches) a device on login.
   * Returns { allowed: false } when the user has reached their device limit
   * and this is a new device.
   */
  static async registerDevice(
    userId: string,
    deviceId: string,
    info?: { deviceName?: string; platform?: string }
  ): Promise<{ allowed: boolean; limit: number; activeCount: number }> {
    const limit = await this.getDeviceLimit(userId);

    const existing = await prisma.device.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });

    if (existing) {
      await prisma.device.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), isActive: true, ...info },
      });
      return { allowed: true, limit, activeCount: await this.countActive(userId) };
    }

    const activeCount = await this.countActive(userId);
    if (activeCount >= limit) {
      return { allowed: false, limit, activeCount };
    }

    await prisma.device.create({
      data: { userId, deviceId, ...info },
    });
    return { allowed: true, limit, activeCount: activeCount + 1 };
  }

  static async countActive(userId: string): Promise<number> {
    return prisma.device.count({ where: { userId, isActive: true } });
  }

  static async listDevices(userId: string) {
    return prisma.device.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  /** Admin: set per-user device quota (1–20). */
  static async setUserDeviceLimit(userId: string, deviceLimit: number) {
    const limit = Math.min(20, Math.max(1, Math.floor(deviceLimit)));
    const user = await prisma.user.update({
      where: { id: userId },
      data: { deviceLimit: limit },
      select: {
        id: true,
        phone: true,
        fullLegalName: true,
        deviceLimit: true,
      },
    });
    return user;
  }

  /** Deactivate a device, freeing a slot. Also kills its sessions. */
  static async deactivateDevice(userId: string, id: string) {
    const device = await prisma.device.findFirst({ where: { id, userId } });
    if (!device) return { success: false as const, error: "NOT_FOUND" };

    await prisma.device.update({ where: { id }, data: { isActive: false } });
    await prisma.session.deleteMany({ where: { userId, deviceId: device.deviceId } });
    return { success: true as const };
  }

  /** Admin: deactivate any device for a user. */
  static async adminDeactivateDevice(userId: string, deviceRowId: string) {
    return this.deactivateDevice(userId, deviceRowId);
  }
}
