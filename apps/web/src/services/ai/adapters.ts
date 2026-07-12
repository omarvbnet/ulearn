import type {
  AiProviderAdapter,
  ChatMessage,
  ChatResult,
  EmbeddingResult,
  ProviderConfig,
} from "./types";
import { EMBEDDING_DIMS } from "./types";

function truncateOrPad(vec: number[], dim = EMBEDDING_DIMS): number[] {
  if (vec.length === dim) return vec;
  if (vec.length > dim) return vec.slice(0, dim);
  return [...vec, ...Array(dim - vec.length).fill(0)];
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Parse JSON body; empty / HTML responses become clear errors (avoids "Unexpected end of JSON input"). */
async function readApiJson(
  res: Response,
  label: string
): Promise<Record<string, unknown>> {
  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error(
      `${label} returned an empty body (HTTP ${res.status}). Check API key, model, and Base URL.`
    );
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${label} returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 180)}`
    );
  }
}

export class GeminiAdapter implements AiProviderAdapter {
  readonly type = "GEMINI";

  private base(config: ProviderConfig) {
    return (config.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  }

  async chat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResult> {
    const model = config.model || "gemini-2.0-flash";
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [];
        if (m.content?.trim()) parts.push({ text: m.content });
        for (const p of m.parts || []) {
          if (p.type === "text" && p.text.trim()) parts.push({ text: p.text });
          if (p.type === "image" && p.dataBase64) {
            parts.push({
              inlineData: {
                mimeType: p.mimeType || "image/jpeg",
                data: p.dataBase64.replace(/^data:[^;]+;base64,/, ""),
              },
            });
          }
        }
        if (!parts.length) parts.push({ text: m.content || "" });
        return {
          role: m.role === "assistant" ? "model" : "user",
          parts,
        };
      });

    const url = `${this.base(config)}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: {
            temperature: config.temperature,
            maxOutputTokens: config.maxTokens,
            topP: config.topP ?? undefined,
          },
        }),
      },
      config.timeoutMs
    );
    const data = await readApiJson(res, "Gemini chat");
    if (!res.ok) {
      const err = data.error as { message?: string } | undefined;
      throw new Error(err?.message || `Gemini chat failed (${res.status})`);
    }
    const candidates = data.candidates as
      | { content?: { parts?: { text?: string }[] } }[]
      | undefined;
    const usage = data.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number }
      | undefined;
    const text =
      candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    return {
      text,
      tokensIn: usage?.promptTokenCount ?? 0,
      tokensOut: usage?.candidatesTokenCount ?? 0,
    };
  }

  async embed(config: ProviderConfig, text: string): Promise<EmbeddingResult> {
    // Always use the embedding model — chat models (flash/pro) cannot embed.
    const model = "gemini-embedding-001";
    const base = this.base(config);
    if (/deepseek|moonshot|openai|anthropic/i.test(base)) {
      throw new Error(
        `Gemini embedding Base URL looks wrong (${base}). Use https://generativelanguage.googleapis.com and a Gemini API key.`
      );
    }
    const url = `${base}/v1beta/models/${model}:embedContent?key=${encodeURIComponent(config.apiKey)}`;
    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: text.slice(0, 8000) }] },
          outputDimensionality: EMBEDDING_DIMS,
        }),
      },
      config.timeoutMs
    );
    const data = await readApiJson(res, "Gemini embed");
    if (!res.ok) {
      const err = data.error as { message?: string } | undefined;
      throw new Error(err?.message || `Gemini embed failed (${res.status})`);
    }
    const embedding = data.embedding as { values?: number[] } | undefined;
    const values: number[] = embedding?.values || [];
    return { embedding: truncateOrPad(values), tokensIn: Math.ceil(text.length / 4) };
  }

  async testConnection(config: ProviderConfig) {
    try {
      await this.embed(config, "ulearn ping");
      return { ok: true, message: "Gemini connection OK" };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Gemini test failed" };
    }
  }
}

export class OpenAiCompatibleAdapter implements AiProviderAdapter {
  readonly type: string;
  constructor(type: string = "OPENAI") {
    this.type = type;
  }

  private base(config: ProviderConfig) {
    return normalizeOpenAiCompatibleBase(this.type, config.baseUrl);
  }

  async chat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResult> {
    const url = `${this.base(config)}/chat/completions`;
    const mapped = messages.map((m) => {
      const images = (m.parts || []).filter((p) => p.type === "image");
      if (!images.length) {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: [
          ...(m.content?.trim()
            ? [{ type: "text" as const, text: m.content }]
            : []),
          ...images.map((img) => ({
            type: "image_url" as const,
            image_url: {
              url: `data:${img.mimeType};base64,${img.dataBase64.replace(/^data:[^;]+;base64,/, "")}`,
            },
          })),
        ],
      };
    });
    const body: Record<string, unknown> = {
      model: config.model || defaultChatModel(this.type),
      messages: mapped,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    };
    if (config.topP != null) body.top_p = config.topP;

    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      config.timeoutMs
    );
    const data = await readApiJson(res, `${this.type} chat`);
    if (!res.ok) {
      const err = data.error as { message?: string } | undefined;
      const detail = err?.message || JSON.stringify(data).slice(0, 200);
      throw new Error(
        `${this.type} chat failed (${res.status}) at ${url}${detail ? `: ${detail}` : ""}`
      );
    }
    const choices = data.choices as { message?: { content?: string } }[] | undefined;
    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return {
      text: choices?.[0]?.message?.content || "",
      tokensIn: usage?.prompt_tokens ?? 0,
      tokensOut: usage?.completion_tokens ?? 0,
    };
  }

  async embed(config: ProviderConfig, text: string): Promise<EmbeddingResult> {
    if (!providerSupportsEmbeddings(this.type)) {
      throw new Error(
        `${this.type} does not support embeddings. Assign the EMBEDDING module to Gemini (gemini-embedding-001) or OpenAI.`
      );
    }
    const url = `${this.base(config)}/embeddings`;
    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model.includes("embed") ? config.model : "text-embedding-3-small",
          input: text.slice(0, 8000),
          dimensions: EMBEDDING_DIMS,
        }),
      },
      config.timeoutMs
    );
    const data = await readApiJson(res, `${this.type} embed`);
    if (!res.ok) {
      const err = data.error as { message?: string } | undefined;
      const detail = err?.message || "";
      throw new Error(
        `${this.type} embed failed (${res.status}) at ${url}${detail ? `: ${detail}` : ""}`
      );
    }
    const list = data.data as { embedding?: number[] }[] | undefined;
    const values: number[] = list?.[0]?.embedding || [];
    const usage = data.usage as { total_tokens?: number } | undefined;
    return {
      embedding: truncateOrPad(values),
      tokensIn: usage?.total_tokens ?? Math.ceil(text.length / 4),
    };
  }

  async testConnection(config: ProviderConfig) {
    try {
      // Kimi / DeepSeek are chat-first; embeddings are unsupported.
      if (this.type === "KIMI" || this.type === "DEEPSEEK") {
        await this.chat(config, [{ role: "user", content: "Reply with OK" }]);
        return { ok: true, message: `${this.type} chat connection OK` };
      }
      await this.embed(config, "ulearn ping");
      return { ok: true, message: `${this.type} connection OK` };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : `${this.type} test failed`,
      };
    }
  }
}

export class AnthropicAdapter implements AiProviderAdapter {
  readonly type = "ANTHROPIC";

  private base(config: ProviderConfig) {
    return (config.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  }

  async chat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    const url = `${this.base(config)}/v1/messages`;
    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": config.apiVersion || "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model || "claude-sonnet-4-20250514",
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          system: system || undefined,
          messages: rest,
        }),
      },
      config.timeoutMs
    );
    const data = await readApiJson(res, "Anthropic chat");
    if (!res.ok) {
      const err = data.error as { message?: string } | undefined;
      throw new Error(err?.message || `Anthropic chat failed (${res.status})`);
    }
    const content = data.content as { text?: string }[] | undefined;
    const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const text = content?.map((c) => c.text || "").join("") || "";
    return {
      text,
      tokensIn: usage?.input_tokens ?? 0,
      tokensOut: usage?.output_tokens ?? 0,
    };
  }

  async embed(_config: ProviderConfig, _text: string): Promise<EmbeddingResult> {
    throw new Error(
      "Anthropic does not provide embeddings — assign the EMBEDDING module to Gemini or OpenAI"
    );
  }

  async testConnection(config: ProviderConfig) {
    try {
      await this.chat(config, [
        { role: "user", content: "Reply with OK" },
      ]);
      return { ok: true, message: "Anthropic connection OK" };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Anthropic test failed" };
    }
  }
}

export function getAdapter(type: string): AiProviderAdapter {
  switch (type) {
    case "GEMINI":
      return new GeminiAdapter();
    case "OPENAI":
      return new OpenAiCompatibleAdapter("OPENAI");
    case "OPENAI_COMPATIBLE":
      return new OpenAiCompatibleAdapter("OPENAI_COMPATIBLE");
    case "KIMI":
      return new OpenAiCompatibleAdapter("KIMI");
    case "DEEPSEEK":
      return new OpenAiCompatibleAdapter("DEEPSEEK");
    case "ANTHROPIC":
      return new AnthropicAdapter();
    default:
      throw new Error(`Unsupported AI provider type: ${type}`);
  }
}

/** Default API base URLs when admin leaves Base URL blank. */
export function defaultBaseUrlForType(type: string): string | null {
  switch (type) {
    case "GEMINI":
      return "https://generativelanguage.googleapis.com";
    case "OPENAI":
      return "https://api.openai.com/v1";
    case "ANTHROPIC":
      return "https://api.anthropic.com";
    case "KIMI":
      return "https://api.moonshot.cn/v1";
    case "DEEPSEEK":
      // Official: both / and /v1 work; /v1 matches OpenAI-compatible clients.
      return "https://api.deepseek.com/v1";
    default:
      return null;
  }
}

/** True when this provider can run the EMBEDDING module. */
export function providerSupportsEmbeddings(type: string): boolean {
  return type === "GEMINI" || type === "OPENAI" || type === "OPENAI_COMPATIBLE";
}

function defaultChatModel(type: string): string {
  switch (type) {
    case "KIMI":
      return "moonshot-v1-8k";
    case "DEEPSEEK":
      return "deepseek-chat";
    default:
      return "gpt-4o-mini";
  }
}

/** Normalize base URL for OpenAI-compatible providers (DeepSeek/Kimi/OpenAI). */
export function normalizeOpenAiCompatibleBase(
  type: string,
  baseUrl?: string | null
): string {
  let base = (baseUrl || "").trim().replace(/\/$/, "");
  // Strip accidental endpoint suffixes pasted into Base URL.
  base = base
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/embeddings$/i, "")
    .replace(/\/$/, "");

  const looksLikeOpenAi =
    !base ||
    /api\.openai\.com/i.test(base) ||
    base === "https://api.openai.com";

  if (type === "DEEPSEEK" && looksLikeOpenAi) {
    base = "https://api.deepseek.com/v1";
  } else if (type === "KIMI" && looksLikeOpenAi) {
    base = "https://api.moonshot.cn/v1";
  } else if (!base) {
    base =
      defaultBaseUrlForType(type) ||
      "https://api.openai.com/v1";
  }

  // DeepSeek accepts both hosts; ensure /v1 for openai-compatible path joining.
  if (type === "DEEPSEEK" && base === "https://api.deepseek.com") {
    base = "https://api.deepseek.com/v1";
  }

  return base.replace(/\/$/, "");
}
