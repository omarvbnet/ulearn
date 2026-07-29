import type {
  AiProviderAdapter,
  ChatMessage,
  ChatResult,
  EmbeddingResult,
  ImageGenerationInput,
  ImageGenerationResult,
  ProviderConfig,
  SpeechSynthesisInput,
  SpeechSynthesisResult,
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

  async synthesizeSpeech(
    config: ProviderConfig,
    input: SpeechSynthesisInput
  ): Promise<SpeechSynthesisResult> {
    const text = input.text.trim().slice(0, 4000);
    if (!text) throw new Error("Empty speech text");
    const lang = (input.language || "en").toLowerCase().slice(0, 2);
    const voice =
      input.voice?.trim() ||
      (lang === "ar" ? "nova" : lang === "tr" ? "onyx" : "alloy");
    const model = /tts|speech|gpt-4o-mini-tts/i.test(config.model)
      ? config.model
      : "tts-1-hd";
    const url = `${this.base(config)}/audio/speech`;
    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: text,
          voice,
          response_format: "mp3",
          speed: 0.98,
        }),
      },
      Math.max(config.timeoutMs || 30000, 60000)
    );
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      throw new Error(
        `${this.type} TTS failed (${res.status}) at ${url}${raw ? `: ${raw.slice(0, 200)}` : ""}`
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const words = text.split(/\s+/).filter(Boolean).length;
    return {
      mimeType: "audio/mpeg",
      dataBase64: buf.toString("base64"),
      durationMs: Math.max(1500, Math.min(45000, words * 380)),
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

export class JinaAdapter implements AiProviderAdapter {
  readonly type = "JINA";

  private embedBase(config: ProviderConfig) {
    return normalizeJinaBase(config.baseUrl, config.model);
  }

  private chatBase(config: ProviderConfig) {
    return normalizeJinaDeepSearchBase(config.baseUrl);
  }

  async chat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResult> {
    if (!isJinaDeepSearchModel(config.model || "")) {
      throw new Error(
        "This Jina model is for embeddings only. Use jina-deepsearch-v1 for chat / AI Creative, or assign an embedding model to EMBEDDING."
      );
    }
    const url = `${this.chatBase(config)}/chat/completions`;
    const mapped = messages.map((m) => ({ role: m.role, content: m.content }));
    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || "jina-deepsearch-v1",
          messages: mapped,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          reasoning_effort: "medium",
        }),
      },
      Math.max(config.timeoutMs, 120_000)
    );
    const data = await readApiJson(res, "Jina DeepSearch chat");
    if (!res.ok) {
      const err = data.error as { message?: string } | undefined;
      const detail = err?.message || JSON.stringify(data).slice(0, 200);
      throw new Error(
        `Jina DeepSearch chat failed (${res.status}) at ${url}${detail ? `: ${detail}` : ""}`
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
    if (isJinaDeepSearchModel(config.model || "")) {
      throw new Error(
        "jina-deepsearch-v1 is chat-only. Use jina-embeddings-v4 (or similar) for EMBEDDING."
      );
    }
    const model = config.model || "jina-embeddings-v4";
    const url = `${this.embedBase(config)}/embeddings`;
    const body: Record<string, unknown> = {
      model,
      input: [text.slice(0, 8000)],
      dimensions: EMBEDDING_DIMS,
      normalized: true,
    };
    // v3/v4 support task tuning; omit for older models to avoid validation errors.
    if (/jina-embeddings-v[34]|jina-clip/i.test(model)) {
      body.task = "retrieval.passage";
    }
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
    const data = await readApiJson(res, "Jina embed");
    if (!res.ok) {
      const err = data.detail as string | undefined;
      const msg = (data.error as { message?: string } | undefined)?.message || err || "";
      throw new Error(
        `Jina embed failed (${res.status}) at ${url}${msg ? `: ${msg}` : ""}`
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
      if (isJinaDeepSearchModel(config.model || "")) {
        await this.chat(config, [{ role: "user", content: "Reply with OK" }]);
        return { ok: true, message: "Jina DeepSearch connection OK" };
      }
      await this.embed(config, "ulearn ping");
      return { ok: true, message: "Jina embeddings connection OK" };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Jina test failed" };
    }
  }
}

export class FluxAdapter implements AiProviderAdapter {
  readonly type = "FLUX";

  private base(config: ProviderConfig) {
    return normalizeFluxBase(config.baseUrl);
  }

  private endpointPath(model: string): string {
    const m = (model || "").toLowerCase();
    if (m.includes("kontext-max") || m.includes("kontext_max") || m === "flux-kontext-max") {
      return "/v1/flux-kontext-max";
    }
    if (m.includes("kontext") || m.includes("flux-kontext")) {
      return "/v1/flux-kontext";
    }
    if (m.includes("flux-2-max")) return "/v1/flux-2-max";
    if (m.includes("flux-2-pro")) return "/v1/flux-2-pro";
    if (m.includes("pro-1.1") || m.includes("flux-pro")) return "/v1/flux-pro-1.1";
    return "/v1/flux-kontext-max";
  }

  async chat(_config: ProviderConfig, _messages: ChatMessage[]): Promise<ChatResult> {
    throw new Error(
      "FLUX is image-only. Assign FLUX to AI_CREATIVE_IMAGE for educational drawings, infographics, and image edits."
    );
  }

  async embed(_config: ProviderConfig, _text: string): Promise<EmbeddingResult> {
    throw new Error("FLUX does not provide embeddings — use Gemini, OpenAI, or Jina.");
  }

  async generateImage(
    config: ProviderConfig,
    input: ImageGenerationInput
  ): Promise<ImageGenerationResult> {
    const url = `${this.base(config)}${this.endpointPath(config.model)}`;
    const body: Record<string, unknown> = {
      prompt: input.prompt.slice(0, 4000),
      width: input.width ?? 1024,
      height: input.height ?? 1024,
      output_format: "png",
    };
    if (input.inputImageBase64) {
      body.input_image = input.inputImageBase64.replace(/^data:[^;]+;base64,/, "");
    }
    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-key": config.apiKey,
        },
        body: JSON.stringify(body),
      },
      Math.max(config.timeoutMs, 60_000)
    );
    const data = await readApiJson(res, "FLUX submit");
    if (!res.ok) {
      const detail =
        (data.detail as string) ||
        (data.error as { message?: string } | undefined)?.message ||
        JSON.stringify(data).slice(0, 200);
      throw new Error(`FLUX submit failed (${res.status}): ${detail}`);
    }
    const pollingUrl =
      (data.polling_url as string) ||
      (data.id
        ? `${this.base(config)}/v1/get_result?id=${encodeURIComponent(String(data.id))}`
        : "");
    if (!pollingUrl) throw new Error("FLUX did not return a polling URL");

    const sampleUrl = await this.pollResult(pollingUrl, config);
    const imgRes = await fetchJson(sampleUrl, { method: "GET" }, Math.max(config.timeoutMs, 60_000));
    if (!imgRes.ok) throw new Error(`FLUX download failed (${imgRes.status})`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return {
      mimeType: "image/png",
      dataBase64: buf.toString("base64"),
      tokensIn: Math.ceil(input.prompt.length / 4),
    };
  }

  private async pollResult(pollingUrl: string, config: ProviderConfig): Promise<string> {
    const deadline = Date.now() + Math.max(config.timeoutMs, 120_000);
    let lastStatus = "";
    while (Date.now() < deadline) {
      const res = await fetchJson(
        pollingUrl,
        { method: "GET", headers: { "x-key": config.apiKey } },
        30_000
      );
      const data = await readApiJson(res, "FLUX poll");
      if (!res.ok) {
        throw new Error(
          `FLUX poll failed (${res.status}): ${JSON.stringify(data).slice(0, 180)}`
        );
      }
      lastStatus = String(data.status || "");
      if (lastStatus === "Ready") {
        const result = data.result as { sample?: string } | undefined;
        const sample = result?.sample || (data.sample as string | undefined);
        if (!sample) throw new Error("FLUX Ready but missing sample URL");
        return sample;
      }
      if (lastStatus === "Error" || lastStatus === "Failed") {
        const msg =
          (data.error as string) ||
          (data.result as { error?: string } | undefined)?.error ||
          "FLUX generation failed";
        throw new Error(msg);
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    throw new Error(`FLUX timed out (last status: ${lastStatus || "unknown"})`);
  }

  async testConnection(config: ProviderConfig) {
    try {
      // Lightweight auth check — BFL has no dedicated ping; submit a tiny request and abort on auth errors.
      const url = `${this.base(config)}${this.endpointPath(config.model)}`;
      const res = await fetchJson(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-key": config.apiKey,
          },
          body: JSON.stringify({
            prompt: "simple green circle on white background educational icon",
            width: 512,
            height: 512,
          }),
        },
        45_000
      );
      const data = await readApiJson(res, "FLUX test");
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Invalid BFL API key (x-key)" };
      }
      if (!res.ok) {
        const detail =
          (data.detail as string) ||
          (data.error as { message?: string } | undefined)?.message ||
          `HTTP ${res.status}`;
        return { ok: false, message: `FLUX test failed: ${detail}` };
      }
      if (!data.polling_url && !data.id) {
        return { ok: false, message: "FLUX accepted but returned no job id" };
      }
      return {
        ok: true,
        message: "FLUX.1 Kontext Max API key OK (job accepted)",
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "FLUX test failed" };
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

/** Default ElevenLabs public voices (multilingual-capable). */
const ELEVENLABS_VOICES: Record<"ar" | "tr" | "en", string> = {
  ar: "EXAVITQu4vr4xnSDxMaL", // Sarah
  tr: "JBFqnCBsd6RMkjVDRZzb", // George
  en: "onwK4e9ZLuTAKqWW03F9", // Daniel
};

function normalizeElevenLabsBase(baseUrl?: string | null): string {
  const raw = (baseUrl || "https://api.elevenlabs.io").replace(/\/$/, "");
  return raw.replace(/\/v1$/i, "");
}

function elevenLabsModelId(model?: string | null): string {
  const m = (model || "").trim();
  if (/^eleven[_-]/i.test(m)) return m;
  return "eleven_multilingual_v2";
}

function elevenLabsVoiceId(
  config: ProviderConfig,
  input: SpeechSynthesisInput
): string {
  const override = (input.voice || config.apiVersion || "").trim();
  if (override && !/^eleven[_-]/i.test(override)) return override;
  // If admin put a voice id in the model field (custom), use it.
  const model = (config.model || "").trim();
  if (model && !/^eleven[_-]/i.test(model) && model.length >= 16) return model;
  const lang = (input.language || "en").toLowerCase().slice(0, 2);
  if (lang === "ar" || lang === "ku") return ELEVENLABS_VOICES.ar;
  if (lang === "tr") return ELEVENLABS_VOICES.tr;
  return ELEVENLABS_VOICES.en;
}

export class ElevenLabsAdapter implements AiProviderAdapter {
  readonly type = "ELEVENLABS";

  async chat(_config: ProviderConfig, _messages: ChatMessage[]): Promise<ChatResult> {
    throw new Error(
      "ElevenLabs is voice-only. Assign ELEVENLABS to VOICE_TTS for AI Teacher classroom speech."
    );
  }

  async embed(_config: ProviderConfig, _text: string): Promise<EmbeddingResult> {
    throw new Error("ElevenLabs does not provide embeddings — use Gemini, OpenAI, or Jina.");
  }

  async synthesizeSpeech(
    config: ProviderConfig,
    input: SpeechSynthesisInput
  ): Promise<SpeechSynthesisResult> {
    const text = input.text.trim().slice(0, 4000);
    if (!text) throw new Error("Empty speech text");
    const voiceId = elevenLabsVoiceId(config, input);
    const modelId = elevenLabsModelId(config.model);
    const base = normalizeElevenLabsBase(config.baseUrl);
    const url = `${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
    const lang = (input.language || "en").toLowerCase().slice(0, 2);
    const languageCode = lang === "ku" ? "ar" : lang === "ar" || lang === "tr" || lang === "en" ? lang : "en";

    const body: Record<string, unknown> = {
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.42,
        similarity_boost: 0.8,
        style: 0.15,
        use_speaker_boost: true,
      },
    };
    // language_code is supported on turbo/flash/v3 (ignored on multilingual_v2).
    if (!/multilingual_v2/i.test(modelId)) {
      body.language_code = languageCode;
    }

    const res = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
      },
      Math.max(config.timeoutMs || 30000, 60000)
    );
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      throw new Error(
        `ElevenLabs TTS failed (${res.status}) at ${url}${raw ? `: ${raw.slice(0, 220)}` : ""}`
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const words = text.split(/\s+/).filter(Boolean).length;
    return {
      mimeType: "audio/mpeg",
      dataBase64: buf.toString("base64"),
      durationMs: Math.max(1500, Math.min(45000, words * 380)),
    };
  }

  async testConnection(config: ProviderConfig) {
    try {
      await this.synthesizeSpeech(config, {
        text: "OK",
        language: "en",
      });
      return { ok: true, message: "ElevenLabs TTS connection OK" };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "ElevenLabs test failed",
      };
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
    case "JINA":
      return new JinaAdapter();
    case "FLUX":
      return new FluxAdapter();
    case "ELEVENLABS":
      return new ElevenLabsAdapter();
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
    case "JINA":
      return "https://api.jina.ai/v1";
    case "FLUX":
      return "https://api.bfl.ai";
    case "ELEVENLABS":
      return "https://api.elevenlabs.io";
    default:
      return null;
  }
}

/** Jina embedding / clip models (knowledge base vectors). */
export function isJinaEmbeddingModel(model: string): boolean {
  return /jina-embeddings|jina-clip/i.test(model);
}

/** Jina DeepSearch chat model (research / text generation). */
export function isJinaDeepSearchModel(model: string): boolean {
  return /jina-deepsearch|deepsearch/i.test(model);
}

export function jinaDefaultBaseUrl(model: string): string {
  return isJinaDeepSearchModel(model)
    ? "https://deepsearch.jina.ai/v1"
    : "https://api.jina.ai/v1";
}

/** True when this provider can run the EMBEDDING module. */
export function providerSupportsEmbeddings(type: string, model?: string): boolean {
  if (type === "JINA") return isJinaEmbeddingModel(model || "jina-embeddings-v4");
  if (type === "FLUX" || type === "ELEVENLABS") return false;
  return type === "GEMINI" || type === "OPENAI" || type === "OPENAI_COMPATIBLE";
}

/** True when this provider can run chat / completion modules. */
export function providerSupportsChat(type: string, model?: string): boolean {
  if (type === "FLUX" || type === "ELEVENLABS") return false;
  if (type === "JINA") return isJinaDeepSearchModel(model || "");
  return true;
}

/** True when this provider can run AI_CREATIVE_IMAGE (raster generate/edit). */
export function providerSupportsImageGeneration(type: string): boolean {
  return type === "FLUX";
}

/** True when this provider can run VOICE_TTS (OpenAI speech or ElevenLabs). */
export function providerSupportsSpeech(type: string): boolean {
  return type === "OPENAI" || type === "OPENAI_COMPATIBLE" || type === "ELEVENLABS";
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

/** Normalize Jina embeddings base URL (keys from https://jina.ai/api-dashboard/key-manager). */
export function normalizeJinaBase(baseUrl?: string | null, model?: string): string {
  if (model && isJinaDeepSearchModel(model)) {
    return normalizeJinaDeepSearchBase(baseUrl);
  }
  let base = (baseUrl || "https://api.jina.ai/v1").trim().replace(/\/$/, "");
  base = base
    .replace(/\/embeddings$/i, "")
    .replace(/\/rerank$/i, "")
    .replace(/\/$/, "");
  if (!base || /deepsearch\.jina\.ai/i.test(base)) base = "https://api.jina.ai/v1";
  return base;
}

/** Normalize Jina DeepSearch chat base URL. */
export function normalizeJinaDeepSearchBase(baseUrl?: string | null): string {
  let base = (baseUrl || "https://deepsearch.jina.ai/v1").trim().replace(/\/$/, "");
  base = base
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/$/, "");
  if (!base || /api\.jina\.ai/i.test(base)) base = "https://deepsearch.jina.ai/v1";
  return base;
}

/** Normalize Black Forest Labs (FLUX) API base. */
export function normalizeFluxBase(baseUrl?: string | null): string {
  let base = (baseUrl || "https://api.bfl.ai").trim().replace(/\/$/, "");
  base = base.replace(/\/v1\/flux.*$/i, "").replace(/\/$/, "");
  if (!base) base = "https://api.bfl.ai";
  return base;
}
