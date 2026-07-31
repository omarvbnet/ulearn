import {
  classroomSpeechLanguage,
  resolveTeacherVoice,
} from "@/services/ai/voice-accent";
import type { ClassroomLang, Emotion } from "../types";

/**
 * Voice Engine — Fish Audio S2 preparation metadata.
 * Actual TTS bytes are streamed by clients via /api/ai/tts (existing Fish path).
 * Engine ensures speech can start immediately with first speak line.
 */
export class VoiceEngine {
  static prepare(input: {
    uiLanguage: ClassroomLang;
    countryCode: string | null;
    provinceName: string | null;
    emotion: Emotion;
    pace: "slow" | "normal" | "brisk";
  }) {
    const speechLanguage = classroomSpeechLanguage(input);
    const voice = resolveTeacherVoice({
      language: input.uiLanguage,
      countryCode: input.countryCode,
      provinceName: input.provinceName,
    });
    return {
      speechLanguage,
      speechLocale: voice.speechLocale,
      accent: voice.accent,
      fishAudioVoiceId: voice.fishAudioVoiceId,
      elevenLanguageCode: voice.elevenLanguageCode,
      emotion: input.emotion,
      pace: input.pace,
      /** Hint for clients: start TTS on first speak event, do not wait for complete. */
      streamSpeech: true as const,
    };
  }
}
