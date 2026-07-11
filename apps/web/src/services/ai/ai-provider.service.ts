import { prisma } from "@/lib/prisma";
import type { AiModuleKey, AiProvider, AiProviderType } from "@prisma/client";
import { decryptSecret, encryptSecret } from "./crypto";
import { getAdapter } from "./adapters";
import type { ChatMessage, ProviderConfig } from "./types";

function toConfig(p: AiProvider, apiKey: string): ProviderConfig {
  return {
    apiKey,
    baseUrl: p.baseUrl,
    model: p.model,
    apiVersion: p.apiVersion,
    timeoutMs: p.timeoutMs,
    maxTokens: p.maxTokens,
    temperature: p.temperature,
    topP: p.topP,
    streaming: p.streaming,
  };
}

export class AiProviderService {
  static async list() {
    const providers = await prisma.aiProvider.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    return providers.map((p) => ({
      ...p,
      apiKeyEncrypted: undefined,
      hasApiKey: Boolean(p.apiKeyEncrypted),
    }));
  }

  static async create(input: {
    name: string;
    type: AiProviderType;
    apiKey?: string;
    baseUrl?: string;
    model: string;
    apiVersion?: string;
    timeoutMs?: number;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    streaming?: boolean;
    retryCount?: number;
    isDefault?: boolean;
  }) {
    if (input.isDefault) {
      await prisma.aiProvider.updateMany({ data: { isDefault: false } });
    }
    return prisma.aiProvider.create({
      data: {
        name: input.name,
        type: input.type,
        apiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey) : null,
        baseUrl: input.baseUrl,
        model: input.model,
        apiVersion: input.apiVersion,
        timeoutMs: input.timeoutMs ?? 60000,
        maxTokens: input.maxTokens ?? 2048,
        temperature: input.temperature ?? 0.3,
        topP: input.topP,
        streaming: input.streaming ?? true,
        retryCount: input.retryCount ?? 2,
        isDefault: input.isDefault ?? false,
      },
    });
  }

  static async update(
    id: string,
    input: Partial<{
      name: string;
      apiKey: string;
      baseUrl: string | null;
      model: string;
      apiVersion: string | null;
      timeoutMs: number;
      maxTokens: number;
      temperature: number;
      topP: number | null;
      streaming: boolean;
      retryCount: number;
      status: "ENABLED" | "DISABLED";
      isDefault: boolean;
      sortOrder: number;
    }>
  ) {
    if (input.isDefault) {
      await prisma.aiProvider.updateMany({ data: { isDefault: false } });
    }
    const data: Record<string, unknown> = { ...input };
    if (input.apiKey) {
      data.apiKeyEncrypted = encryptSecret(input.apiKey);
      delete data.apiKey;
    }
    return prisma.aiProvider.update({ where: { id }, data });
  }

  static async remove(id: string) {
    await prisma.aiProvider.delete({ where: { id } });
  }

  static async setModuleAssignment(moduleKey: AiModuleKey, providerId: string) {
    return prisma.aiModuleAssignment.upsert({
      where: { moduleKey },
      create: { moduleKey, providerId },
      update: { providerId },
    });
  }

  static async listModuleAssignments() {
    return prisma.aiModuleAssignment.findMany({ include: { provider: true } });
  }

  static async resolveProvider(moduleKey?: AiModuleKey): Promise<AiProvider | null> {
    if (moduleKey) {
      const assigned = await prisma.aiModuleAssignment.findUnique({
        where: { moduleKey },
        include: { provider: true },
      });
      if (assigned?.provider?.status === "ENABLED") return assigned.provider;
    }
    return prisma.aiProvider.findFirst({
      where: { status: "ENABLED", isDefault: true },
    });
  }

  static async withFallback<T>(
    moduleKey: AiModuleKey | undefined,
    run: (provider: AiProvider, config: ProviderConfig) => Promise<T>
  ): Promise<{ result: T; provider: AiProvider }> {
    const primary = await this.resolveProvider(moduleKey);
    const fallbacks = await prisma.aiProvider.findMany({
      where: { status: "ENABLED", ...(primary ? { id: { not: primary.id } } : {}) },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    });
    const chain = primary ? [primary, ...fallbacks] : fallbacks;
    let lastError: unknown;
    for (const provider of chain) {
      if (!provider.apiKeyEncrypted) continue;
      try {
        const apiKey = decryptSecret(provider.apiKeyEncrypted);
        const result = await run(provider, toConfig(provider, apiKey));
        return { result, provider };
      } catch (e) {
        lastError = e;
        await prisma.aiUsageLog.create({
          data: {
            providerId: provider.id,
            moduleKey: moduleKey ?? null,
            success: false,
            errorMessage: e instanceof Error ? e.message : "Provider failed",
          },
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No AI provider available");
  }

  static async test(id: string) {
    const provider = await prisma.aiProvider.findUnique({ where: { id } });
    if (!provider?.apiKeyEncrypted) return { ok: false, message: "Missing API key" };
    const adapter = getAdapter(provider.type);
    const config = toConfig(provider, decryptSecret(provider.apiKeyEncrypted));
    return adapter.testConnection(config);
  }

  static async chat(moduleKey: AiModuleKey | undefined, messages: ChatMessage[], userId?: string) {
    const started = Date.now();
    const { result, provider } = await this.withFallback(moduleKey, async (p, config) => {
      const adapter = getAdapter(p.type);
      return adapter.chat(config, messages);
    });
    await prisma.aiUsageLog.create({
      data: {
        providerId: provider.id,
        userId,
        moduleKey: moduleKey ?? null,
        success: true,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: Date.now() - started,
        costEstimate: estimateCost(provider.type, result.tokensIn, result.tokensOut),
      },
    });
    return { ...result, providerId: provider.id };
  }

  static async embed(text: string, userId?: string) {
    const started = Date.now();
    const { result, provider } = await this.withFallback("EMBEDDING", async (p, config) => {
      const adapter = getAdapter(p.type);
      return adapter.embed(config, text);
    });
    await prisma.aiUsageLog.create({
      data: {
        providerId: provider.id,
        userId,
        moduleKey: "EMBEDDING",
        success: true,
        tokensIn: result.tokensIn,
        latencyMs: Date.now() - started,
        costEstimate: estimateCost(provider.type, result.tokensIn, 0) * 0.1,
      },
    });
    return result.embedding;
  }
}

function estimateCost(type: string, tokensIn: number, tokensOut: number): number {
  // Rough USD estimates for dashboards — not billing truth.
  const rates: Record<string, { in: number; out: number }> = {
    GEMINI: { in: 0.0000001, out: 0.0000004 },
    OPENAI: { in: 0.00000015, out: 0.0000006 },
    ANTHROPIC: { in: 0.000003, out: 0.000015 },
    OPENAI_COMPATIBLE: { in: 0.0000001, out: 0.0000004 },
  };
  const r = rates[type] || rates.GEMINI;
  return tokensIn * r.in + tokensOut * r.out;
}
