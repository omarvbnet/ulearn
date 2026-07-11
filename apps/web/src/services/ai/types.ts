/** Unified AI provider adapter — business logic never imports vendor SDKs directly. */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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
}

export const EMBEDDING_DIMS = 768;
export const UNAVAILABLE_ANSWER =
  "The requested information is not available in the educational material uploaded to U Learn.";
