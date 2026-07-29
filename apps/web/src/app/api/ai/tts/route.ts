import { error, json, requireAuth } from "@/lib/api";
import { AiProviderService } from "@/services/ai/ai-provider.service";
import { z } from "zod";

const schema = z.object({
  text: z.string().min(1).max(4000),
  /** Classroom languages: ar | tr | en (ku maps to ar on the client). */
  language: z.string().max(16).optional(),
  voice: z.string().max(40).optional(),
});

function normalizeTtsLang(raw?: string | null): "ar" | "tr" | "en" {
  const lang = (raw || "en").toLowerCase().slice(0, 2);
  if (lang === "ar" || lang === "ku") return "ar";
  if (lang === "tr") return "tr";
  return "en";
}

/**
 * Cloud text-to-speech for AI Teacher classroom.
 * Uses the admin-assigned VOICE_TTS provider (OpenAI /audio/speech).
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const language = normalizeTtsLang(parsed.data.language);
  const text = parsed.data.text.trim();
  if (!text) return error("Empty text", 422, "VALIDATION");

  try {
    const result = await AiProviderService.synthesizeSpeech(
      {
        text,
        language,
        voice: parsed.data.voice,
      },
      auth.session.userId
    );
    return json({
      mimeType: result.mimeType,
      dataBase64: result.dataBase64,
      durationMs: result.durationMs ?? null,
      language,
      providerId: result.providerId,
    });
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Speech synthesis failed",
      500,
      "VOICE_TTS"
    );
  }
}
