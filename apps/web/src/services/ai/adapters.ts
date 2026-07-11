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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `Gemini chat failed (${res.status})`);
    }
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ||
      "";
    return {
      text,
      tokensIn: data?.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data?.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  async embed(config: ProviderConfig, text: string): Promise<EmbeddingResult> {
    const model = "text-embedding-004";
    const url = `${this.base(config)}/v1beta/models/${model}:embedContent?key=${encodeURIComponent(config.apiKey)}`;
    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: text.slice(0, 8000) }] },
        }),
      },
      config.timeoutMs
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `Gemini embed failed (${res.status})`);
    }
    const values: number[] = data?.embedding?.values || [];
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
    return (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
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
    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || "gpt-4o-mini",
          messages: mapped,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          top_p: config.topP ?? undefined,
        }),
      },
      config.timeoutMs
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `OpenAI chat failed (${res.status})`);
    }
    return {
      text: data?.choices?.[0]?.message?.content || "",
      tokensIn: data?.usage?.prompt_tokens ?? 0,
      tokensOut: data?.usage?.completion_tokens ?? 0,
    };
  }

  async embed(config: ProviderConfig, text: string): Promise<EmbeddingResult> {
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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `OpenAI embed failed (${res.status})`);
    }
    const values: number[] = data?.data?.[0]?.embedding || [];
    return {
      embedding: truncateOrPad(values),
      tokensIn: data?.usage?.total_tokens ?? Math.ceil(text.length / 4),
    };
  }

  async testConnection(config: ProviderConfig) {
    try {
      await this.embed(config, "ulearn ping");
      return { ok: true, message: `${this.type} connection OK` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "OpenAI test failed" };
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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `Anthropic chat failed (${res.status})`);
    }
    const text =
      data?.content?.map((c: { text?: string }) => c.text || "").join("") || "";
    return {
      text,
      tokensIn: data?.usage?.input_tokens ?? 0,
      tokensOut: data?.usage?.output_tokens ?? 0,
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
    case "ANTHROPIC":
      return new AnthropicAdapter();
    default:
      throw new Error(`Unsupported AI provider type: ${type}`);
  }
}
