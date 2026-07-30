import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { AiProviderService } from "@/services/ai/ai-provider.service";
import { resolveTeacherVoice } from "@/services/ai/voice-accent";
import { z } from "zod";

const schema = z.object({
  text: z.string().min(1).max(4000),
  /** Selected UI / classroom language: ar | tr | en | ku */
  language: z.string().max(16).optional(),
  /** Optional ISO country override; otherwise loaded from the user profile */
  country: z.string().max(8).optional(),
  voice: z.string().max(40).optional(),
  pace: z.enum(["slow", "normal", "brisk"]).optional(),
});

/**
 * Cloud text-to-speech for AI Teacher classroom.
 * Accent + language follow the student's selected language and country.
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const text = parsed.data.text.trim();
  if (!text) return error("Empty text", 422, "VALIDATION");

  const profile = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: {
      locale: true,
      country: { select: { code: true } },
      province: { select: { nameEn: true } },
    },
  });

  const resolved = resolveTeacherVoice({
    language: parsed.data.language || profile?.locale || "en",
    countryCode: parsed.data.country || profile?.country?.code || null,
    provinceName: profile?.province?.nameEn || null,
    voiceOverride: parsed.data.voice,
  });

  try {
    const result = await AiProviderService.synthesizeSpeech(
      {
        text,
        language: resolved.selectedLanguage,
        countryCode: resolved.countryCode,
        voice: resolved.openaiVoice,
        pace: parsed.data.pace || "normal",
      },
      auth.session.userId
    );
    return json({
      mimeType: result.mimeType,
      dataBase64: result.dataBase64,
      durationMs: result.durationMs ?? null,
      language: resolved.language,
      selectedLanguage: resolved.selectedLanguage,
      speechLocale: resolved.speechLocale,
      accent: resolved.accent,
      countryCode: resolved.countryCode,
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
