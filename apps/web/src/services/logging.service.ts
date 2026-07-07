import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export class LoggingService {
  static async log(params: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    previousValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? undefined,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        previousValue: params.previousValue,
        newValue: params.newValue,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  }

  static async getEntityLogs(entityType: string, entityId: string, limit = 50) {
    return prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { actor: { select: { id: true, fullLegalName: true, phone: true } } },
    });
  }

  static async getRecentLogs(limit = 100) {
    return prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { actor: { select: { id: true, fullLegalName: true, phone: true, role: true } } },
    });
  }
}
