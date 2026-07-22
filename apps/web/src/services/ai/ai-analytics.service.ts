import { prisma } from "@/lib/prisma";

export class AiAnalyticsService {
  static async usageSummary(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const logs = await prisma.aiUsageLog.findMany({
      where: { createdAt: { gte: since } },
      include: { provider: { select: { id: true, name: true, type: true } } },
      orderBy: { createdAt: "asc" },
    });

    const byDay = new Map<string, { date: string; requests: number; tokens: number; cost: number; errors: number }>();
    const byProvider = new Map<
      string,
      { providerId: string; name: string; type: string; requests: number; tokensIn: number; tokensOut: number; cost: number; errors: number; latencySum: number }
    >();

    for (const log of logs) {
      const date = log.createdAt.toISOString().slice(0, 10);
      const day = byDay.get(date) || { date, requests: 0, tokens: 0, cost: 0, errors: 0 };
      day.requests += 1;
      day.tokens += log.tokensIn + log.tokensOut;
      day.cost += log.costEstimate;
      if (!log.success) day.errors += 1;
      byDay.set(date, day);

      const pid = log.providerId || "unknown";
      const prev = byProvider.get(pid) || {
        providerId: pid,
        name: log.provider?.name || "Unknown",
        type: log.provider?.type || "?",
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        errors: 0,
        latencySum: 0,
      };
      prev.requests += 1;
      prev.tokensIn += log.tokensIn;
      prev.tokensOut += log.tokensOut;
      prev.cost += log.costEstimate;
      prev.latencySum += log.latencyMs;
      if (!log.success) prev.errors += 1;
      byProvider.set(pid, prev);
    }

    const providers = [...byProvider.values()].map((p) => ({
      providerId: p.providerId,
      name: p.name,
      type: p.type,
      requests: p.requests,
      tokensIn: p.tokensIn,
      tokensOut: p.tokensOut,
      cost: p.cost,
      errors: p.errors,
      avgLatencyMs: p.requests ? Math.round(p.latencySum / p.requests) : 0,
    }));

    return {
      totals: {
        requests: logs.length,
        tokensIn: logs.reduce((s, l) => s + l.tokensIn, 0),
        tokensOut: logs.reduce((s, l) => s + l.tokensOut, 0),
        cost: logs.reduce((s, l) => s + l.costEstimate, 0),
        errors: logs.filter((l) => !l.success).length,
        successRate: logs.length
          ? Math.round((logs.filter((l) => l.success).length / logs.length) * 1000) / 10
          : 100,
      },
      byDay: [...byDay.values()],
      byProvider: providers,
    };
  }
}
