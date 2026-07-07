import { prisma } from "@/lib/prisma";

/**
 * Device registration and limit enforcement.
 * A user's device limit is the highest limit among their active subscriptions
 * (default 1 when no subscription — free content only needs one device).
 */
export class DeviceService {
  static async getDeviceLimit(userId: string): Promise<number> {
    const subs = await prisma.subscription.findMany({
      where: {
        userId,
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { deviceLimit: true },
    });
    return Math.max(1, ...subs.map((s) => s.deviceLimit));
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

  /** Deactivate a device, freeing a slot. Also kills its sessions. */
  static async deactivateDevice(userId: string, id: string) {
    const device = await prisma.device.findFirst({ where: { id, userId } });
    if (!device) return { success: false as const, error: "NOT_FOUND" };

    await prisma.device.update({ where: { id }, data: { isActive: false } });
    await prisma.session.deleteMany({ where: { userId, deviceId: device.deviceId } });
    return { success: true as const };
  }
}
