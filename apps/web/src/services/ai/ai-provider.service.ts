import { prisma } from "@/lib/prisma";
import type { AiModuleKey, AiProvider, AiProviderType } from "@prisma/client";
import { decryptSecret, encryptSecret } from "./crypto";
import { defaultBaseUrlForType, getAdapter, jinaDefaultBaseUrl, normalizeOpenAiCompatibleBase, providerSupportsChat, providerSupportsEmbeddings, providerSupportsImageGeneration } from "./adapters";
import type { ChatMessage, ImageGenerationInput, ProviderConfig } from "./types";

function toConfig(p: AiProvider, apiKey: string): ProviderConfig {
  const openAiCompat =
    p.type === "OPENAI" ||
    p.type === "OPENAI_COMPATIBLE" ||
    p.type === "KIMI" ||
    p.type === "DEEPSEEK";
  return {
    apiKey,
    baseUrl: openAiCompat
      ? normalizeOpenAiCompatibleBase(p.type, p.baseUrl)
      : p.type === "JINA"
        ? p.baseUrl || jinaDefaultBaseUrl(p.model)
        : p.baseUrl || defaultBaseUrlForType(p.type),
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
        baseUrl:
          input.baseUrl ||
          (["OPENAI", "OPENAI_COMPATIBLE", "KIMI", "DEEPSEEK"].includes(input.type)
            ? normalizeOpenAiCompatibleBase(input.type, input.baseUrl)
            : defaultBaseUrlForType(input.type)) ||
          null,
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
    const provider = await prisma.aiProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new Error("Provider not found");
    if (moduleKey === "EMBEDDING" && !providerSupportsEmbeddings(provider.type, provider.model)) {
      throw new Error(
        `${provider.type} (${provider.name}) cannot run embeddings. Assign EMBEDDING to Gemini, OpenAI, or a Jina embedding model.`
      );
    }
    if (moduleKey === "AI_CREATIVE_IMAGE") {
      if (!providerSupportsImageGeneration(provider.type)) {
        throw new Error(
          `${provider.type} (${provider.name}) cannot generate images. Assign AI_CREATIVE_IMAGE to FLUX.1 Kontext Max (Black Forest Labs).`
        );
      }
    } else if (moduleKey !== "EMBEDDING" && !providerSupportsChat(provider.type, provider.model)) {
      throw new Error(
        `${provider.type} (${provider.name}) cannot run chat. Use a chat provider or jina-deepsearch-v1 for AI Creative text/PPT.`
      );
    }
    return prisma.aiModuleAssignment.upsert({
      where: { moduleKey },
      create: { moduleKey, providerId },
      update: { providerId },
    });
  }

  static async listModuleAssignments() {
    return prisma.aiModuleAssignment.findMany({ include: { provider: true } });
  }

  /** First enabled Gemini/OpenAI/compatible/Jina-embedding provider that has an API key. */
  static async findEmbeddingCapableProvider(): Promise<AiProvider | null> {
    const candidates = await prisma.aiProvider.findMany({
      where: {
        status: "ENABLED",
        type: { in: ["GEMINI", "OPENAI", "OPENAI_COMPATIBLE", "JINA"] },
        apiKeyEncrypted: { not: null },
      },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    });
    return (
      candidates.find((p) => providerSupportsEmbeddings(p.type, p.model)) ?? null
    );
  }

  /**
   * If EMBEDDING points at DeepSeek/Kimi/Claude (or is missing), reassign to
   * Gemini/OpenAI when one exists — fixes KB ingest without a manual admin hop.
   */
  static async ensureEmbeddingAssignment(): Promise<AiProvider | null> {
    const assigned = await prisma.aiModuleAssignment.findUnique({
      where: { moduleKey: "EMBEDDING" },
      include: { provider: true },
    });
    if (
      assigned?.provider?.status === "ENABLED" &&
      providerSupportsEmbeddings(assigned.provider.type, assigned.provider.model) &&
      assigned.provider.apiKeyEncrypted
    ) {
      return assigned.provider;
    }

    const capable = await this.findEmbeddingCapableProvider();
    if (!capable) return null;

    await prisma.aiModuleAssignment.upsert({
      where: { moduleKey: "EMBEDDING" },
      create: { moduleKey: "EMBEDDING", providerId: capable.id },
      update: { providerId: capable.id },
    });
    return capable;
  }

  static async resolveProvider(moduleKey?: AiModuleKey): Promise<AiProvider | null> {
    if (moduleKey === "EMBEDDING") {
      const healed = await this.ensureEmbeddingAssignment();
      if (healed) return healed;
    } else if (moduleKey) {
      const assigned = await prisma.aiModuleAssignment.findUnique({
        where: { moduleKey },
        include: { provider: true },
      });
      if (assigned?.provider?.status === "ENABLED") return assigned.provider;
    }
    const fallbackDefault = await prisma.aiProvider.findFirst({
      where: { status: "ENABLED", isDefault: true },
    });
    // Never resolve a chat-only default for embeddings.
    if (moduleKey === "EMBEDDING" && fallbackDefault && !providerSupportsEmbeddings(fallbackDefault.type, fallbackDefault.model)) {
      return this.findEmbeddingCapableProvider();
    }
    return fallbackDefault;
  }

  static async withFallback<T>(
    moduleKey: AiModuleKey | undefined,
    run: (provider: AiProvider, config: ProviderConfig) => Promise<T>,
    opts?: { preferTypes?: string[]; skipTypes?: string[] }
  ): Promise<{ result: T; provider: AiProvider }> {
    const primary = await this.resolveProvider(moduleKey);
    const fallbacks = await prisma.aiProvider.findMany({
      where: { status: "ENABLED", ...(primary ? { id: { not: primary.id } } : {}) },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    });
    let chain = primary ? [primary, ...fallbacks] : fallbacks;
    if (moduleKey === "EMBEDDING") {
      // Prefer embed-capable providers; never call DeepSeek/Kimi/Claude for vectors.
      const embedOpts = {
        preferTypes: opts?.preferTypes?.length
          ? opts.preferTypes
          : ["GEMINI", "OPENAI", "OPENAI_COMPATIBLE", "JINA"],
        skipTypes: [...(opts?.skipTypes || []), "DEEPSEEK", "KIMI", "ANTHROPIC", "FLUX"],
      };
      opts = embedOpts;
    } else if (moduleKey === "AI_CREATIVE_IMAGE") {
      opts = {
        preferTypes: opts?.preferTypes?.length ? opts.preferTypes : ["FLUX"],
        skipTypes: [
          ...(opts?.skipTypes || []),
          "DEEPSEEK",
          "KIMI",
          "ANTHROPIC",
          "JINA",
          "GEMINI",
          "OPENAI",
          "OPENAI_COMPATIBLE",
        ],
      };
    } else if (moduleKey === "AI_CREATIVE") {
      // Document text (PDF/PPT/Word) must come from DeepSeek chat — not FLUX/Jina/Gemini.
      opts = {
        preferTypes: opts?.preferTypes?.length
          ? opts.preferTypes
          : ["DEEPSEEK"],
        skipTypes: [
          ...(opts?.skipTypes || []),
          "FLUX",
          "JINA",
        ],
      };
    } else if (moduleKey) {
      // Chat modules: never use FLUX (image-only).
      opts = {
        ...opts,
        skipTypes: [...(opts?.skipTypes || []), "FLUX"],
      };
    }
    if (opts?.preferTypes?.length) {
      const preferred = chain.filter((p) => opts.preferTypes!.includes(p.type));
      const rest = chain.filter((p) => !opts.preferTypes!.includes(p.type));
      chain = [...preferred, ...rest];
    }
    if (opts?.skipTypes?.length) {
      const skipped = chain.filter((p) => opts.skipTypes!.includes(p.type));
      const keep = chain.filter((p) => !opts.skipTypes!.includes(p.type));
      // For embeddings, never fall back to chat-only providers.
      chain = moduleKey === "EMBEDDING" ? keep : keep.length ? keep : skipped;
    }
    let lastError: unknown;
    let triedEmbedCapable = false;
    for (const provider of chain) {
      if (!provider.apiKeyEncrypted) continue;
      if (
        moduleKey === "AI_CREATIVE_IMAGE" &&
        !providerSupportsImageGeneration(provider.type)
      ) {
        lastError = new Error(
          `${provider.type} (${provider.name}) cannot generate images. Assign AI_CREATIVE_IMAGE to FLUX.`
        );
        continue;
      }
      if (moduleKey !== "EMBEDDING" && moduleKey !== "AI_CREATIVE_IMAGE" && !providerSupportsChat(provider.type, provider.model)) {
        lastError = new Error(
          `${provider.type} (${provider.name}) is embedding-only. Use jina-deepsearch-v1 for chat / AI Creative.`
        );
        continue;
      }
      if (moduleKey === "EMBEDDING" && !providerSupportsEmbeddings(provider.type, provider.model)) {
        lastError = new Error(
          `${provider.type} (${provider.name}) cannot run embeddings. Assign EMBEDDING to Gemini, OpenAI, or Jina.`
        );
        continue;
      }
      if (moduleKey === "EMBEDDING") triedEmbedCapable = true;
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
    if (moduleKey === "EMBEDDING" && !triedEmbedCapable) {
      throw new Error(
        "No embedding provider available. Add Gemini, OpenAI, or Jina with an API key, then assign EMBEDDING to it — DeepSeek/Kimi/Claude are chat-only."
      );
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

  static async chat(
    moduleKey: AiModuleKey | undefined,
    messages: ChatMessage[],
    userId?: string,
    overrides?: {
      maxTokens?: number;
      temperature?: number;
      preferTypes?: string[];
      skipTypes?: string[];
      disableThinking?: boolean;
    }
  ) {
    const started = Date.now();
    const needsVision = messages.some((m) =>
      (m.parts || []).some((p) => p.type === "image" && Boolean(p.dataBase64))
    );
    const { result, provider } = await this.withFallback(
      moduleKey,
      async (p, config) => {
        const adapter = getAdapter(p.type);
        const next: ProviderConfig = {
          ...config,
          ...(overrides?.maxTokens != null
            ? { maxTokens: Math.max(config.maxTokens, overrides.maxTokens) }
            : {}),
          ...(overrides?.temperature != null
            ? { temperature: overrides.temperature }
            : {}),
          ...(overrides?.disableThinking ? { disableThinking: true } : {}),
        };
        return adapter.chat(next, messages);
      },
      needsVision
        ? {
            preferTypes: ["GEMINI", "OPENAI", "OPENAI_COMPATIBLE"],
            skipTypes: ["DEEPSEEK", "KIMI", ...(overrides?.skipTypes || [])],
          }
        : {
            preferTypes: overrides?.preferTypes,
            skipTypes: overrides?.skipTypes,
          }
    );
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
    return { ...result, providerId: provider.id, providerType: provider.type, providerName: provider.name };
  }

  /**
   * Token-streaming chat. Emits deltas via onDelta as they arrive; resolves
   * with the full result. Providers without stream support fall back to a
   * full completion emitted as one delta. If a provider fails mid-stream the
   * fallback provider restarts the answer — callers should replace, not
   * append, the final text from the resolved result.
   */
  static async chatStream(
    moduleKey: AiModuleKey | undefined,
    messages: ChatMessage[],
    userId: string | undefined,
    onDelta: (text: string) => void,
    overrides?: {
      maxTokens?: number;
      temperature?: number;
      preferTypes?: string[];
      skipTypes?: string[];
      disableThinking?: boolean;
    }
  ) {
    const started = Date.now();
    const needsVision = messages.some((m) =>
      (m.parts || []).some((p) => p.type === "image" && Boolean(p.dataBase64))
    );
    const { result, provider } = await this.withFallback(
      moduleKey,
      async (p, config) => {
        const adapter = getAdapter(p.type);
        const next: ProviderConfig = {
          ...config,
          ...(overrides?.maxTokens != null
            ? { maxTokens: Math.max(config.maxTokens, overrides.maxTokens) }
            : {}),
          ...(overrides?.temperature != null
            ? { temperature: overrides.temperature }
            : {}),
          ...(overrides?.disableThinking ? { disableThinking: true } : {}),
        };
        if (adapter.chatStream && next.streaming !== false) {
          return adapter.chatStream(next, messages, onDelta);
        }
        const full = await adapter.chat(next, messages);
        if (full.text) onDelta(full.text);
        return full;
      },
      needsVision
        ? {
            preferTypes: ["GEMINI", "OPENAI", "OPENAI_COMPATIBLE"],
            skipTypes: ["DEEPSEEK", "KIMI", ...(overrides?.skipTypes || [])],
          }
        : {
            preferTypes: overrides?.preferTypes,
            skipTypes: overrides?.skipTypes,
          }
    );
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
    return { ...result, providerId: provider.id, providerType: provider.type, providerName: provider.name };
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

  static async generateImage(input: ImageGenerationInput, userId?: string) {
    const started = Date.now();
    const { result, provider } = await this.withFallback(
      "AI_CREATIVE_IMAGE",
      async (p, config) => {
        const adapter = getAdapter(p.type);
        if (!adapter.generateImage) {
          throw new Error(`${p.type} does not support image generation`);
        }
        return adapter.generateImage(config, input);
      }
    );
    await prisma.aiUsageLog.create({
      data: {
        providerId: provider.id,
        userId,
        moduleKey: "AI_CREATIVE_IMAGE",
        success: true,
        tokensIn: result.tokensIn ?? 0,
        latencyMs: Date.now() - started,
        costEstimate: 0.08,
      },
    });
    return { ...result, providerId: provider.id };
  }
}

function estimateCost(type: string, tokensIn: number, tokensOut: number): number {
  // Rough USD estimates for dashboards — not billing truth.
  const rates: Record<string, { in: number; out: number }> = {
    GEMINI: { in: 0.0000001, out: 0.0000004 },
    OPENAI: { in: 0.00000015, out: 0.0000006 },
    ANTHROPIC: { in: 0.000003, out: 0.000015 },
    OPENAI_COMPATIBLE: { in: 0.0000001, out: 0.0000004 },
    KIMI: { in: 0.00000012, out: 0.00000012 },
    DEEPSEEK: { in: 0.00000014, out: 0.00000028 },
    JINA: { in: 0.00000002, out: 0 },
    FLUX: { in: 0.00008, out: 0 },
  };
  const r = rates[type] || rates.GEMINI;
  return tokensIn * r.in + tokensOut * r.out;
}
