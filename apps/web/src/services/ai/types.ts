/** Unified AI provider adapter — business logic never imports vendor SDKs directly. */

import { accentInstruction } from "./voice-accent";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; dataBase64: string };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  /** Optional multimodal parts (images). Text still lives in `content`. */
  parts?: ChatContentPart[];
};

export type ChatResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
};

export type EmbeddingResult = {
  embedding: number[];
  tokensIn: number;
};

export type ImageGenerationInput = {
  prompt: string;
  /** Optional source image for edit / kontext (base64 without data: prefix). */
  inputImageBase64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
};

export type ImageGenerationResult = {
  mimeType: string;
  dataBase64: string;
  tokensIn?: number;
};

export type SpeechSynthesisInput = {
  text: string;
  /** ar | tr | en (ku falls back via voice-accent resolver) */
  language?: string | null;
  /** ISO country code (IQ, TR, SA, …) — shapes accent/voice */
  countryCode?: string | null;
  /** Optional province/region name for finer dialect */
  provinceName?: string | null;
  /** Optional provider voice override (OpenAI name, Fish Audio model id, or ElevenLabs id) */
  voice?: string | null;
  /** Speaking pace hint for more natural classroom delivery */
  pace?: "slow" | "normal" | "brisk" | null;
};

export type SpeechSynthesisResult = {
  mimeType: string;
  dataBase64: string;
  /** Approximate spoken duration hint in ms (client may refine). */
  durationMs?: number;
};

export type ProviderConfig = {
  apiKey: string;
  baseUrl?: string | null;
  model: string;
  apiVersion?: string | null;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  topP?: number | null;
  streaming: boolean;
};

export interface AiProviderAdapter {
  readonly type: string;
  chat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResult>;
  embed(config: ProviderConfig, text: string): Promise<EmbeddingResult>;
  testConnection(config: ProviderConfig): Promise<{ ok: boolean; message: string }>;
  /** Optional: raster image generation / editing (e.g. FLUX.1 Kontext). */
  generateImage?(
    config: ProviderConfig,
    input: ImageGenerationInput
  ): Promise<ImageGenerationResult>;
  /** Optional: cloud TTS for AI Teacher classroom (OpenAI / compatible). */
  synthesizeSpeech?(
    config: ProviderConfig,
    input: SpeechSynthesisInput
  ): Promise<SpeechSynthesisResult>;
}

export const EMBEDDING_DIMS = 768;
export const UNAVAILABLE_ANSWER =
  "The requested information is not available in the educational material uploaded to U Learn.";

export function unavailableAnswer(language?: string | null): string {
  const lang = (language || "en").toLowerCase().slice(0, 2);
  switch (lang) {
    case "ar":
      return "المعلومات المطلوبة غير متوفرة في المواد التعليمية المرفوعة على U Learn.";
    case "ku":
      return "زانیاری داواکراو لە ماددە فێرکارییەکانی بارکراو بۆ U Learn بەردەست نییە.";
    case "tr":
      return "İstenen bilgi, U Learn’e yüklenen eğitim materyallerinde mevcut değil.";
    default:
      return UNAVAILABLE_ANSWER;
  }
}

export function languageInstruction(
  language?: string | null,
  countryCode?: string | null
): string {
  return accentInstruction(language, countryCode);
}

export type ChatAttachmentInput = {
  fileName: string;
  mimeType: string;
  /** Raw base64 (no data: prefix). Prefer fileKey for large PDFs. */
  dataBase64?: string;
  /** R2 / local upload key from /api/uploads */
  fileKey?: string;
  fileUrl?: string;
};
