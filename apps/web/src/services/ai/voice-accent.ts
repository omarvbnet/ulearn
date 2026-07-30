/**
 * Resolve AI Teacher speaking language + accent from the student's
 * selected app language and registered country.
 */

export type TeacherSpeechLanguage = "ar" | "tr" | "en" | "ku";

export type ResolvedTeacherVoice = {
  /** Content / TTS base language */
  language: "ar" | "tr" | "en";
  /** Original selected language (may be ku) */
  selectedLanguage: TeacherSpeechLanguage;
  countryCode: string | null;
  provinceName: string | null;
  /** BCP-47 tag for speech recognition */
  speechLocale: string;
  /** OpenAI /audio/speech voice name */
  openaiVoice: string;
  /** ElevenLabs voice id */
  elevenLabsVoiceId: string;
  /** ElevenLabs language_code when supported */
  elevenLanguageCode: string;
  /** Human-readable accent key for prompts / debugging */
  accent: string;
};

const ELEVEN = {
  /** Sarah — clear multilingual female */
  sarah: "EXAVITQu4vr4xnSDxMaL",
  /** Daniel — warm English male */
  daniel: "onwK4e9ZLuTAKqWW03F9",
  /** George — deeper multilingual male (good for TR/EN) */
  george: "JBFqnCBsd6RMkjVDRZzb",
  /** Lily — soft English */
  lily: "pFZP5JQG7iQjIQuC4Bku",
  /** Adam — US English male */
  adam: "pNInz6obpgDQGcFmaJgB",
} as const;

function normLang(raw?: string | null): TeacherSpeechLanguage {
  const lang = (raw || "en").toLowerCase().slice(0, 2);
  if (lang === "ar") return "ar";
  if (lang === "ku") return "ku";
  if (lang === "tr") return "tr";
  return "en";
}

function normCountry(raw?: string | null): string | null {
  const c = (raw || "").trim().toUpperCase();
  return c.length === 2 ? c : null;
}

function arabicAccent(country: string | null): {
  speechLocale: string;
  accent: string;
  openaiVoice: string;
  elevenLabsVoiceId: string;
} {
  // Levant / Iraq
  if (country && ["IQ", "SY", "JO", "LB", "PS", "YE"].includes(country)) {
    return {
      speechLocale: country === "IQ" ? "ar-IQ" : "ar-JO",
      accent: country === "IQ" ? "iraqi_levantine" : "levantine",
      openaiVoice: "nova",
      elevenLabsVoiceId: ELEVEN.sarah,
    };
  }
  // Gulf
  if (country && ["SA", "AE", "KW", "QA", "BH", "OM"].includes(country)) {
    return {
      speechLocale: country === "SA" ? "ar-SA" : "ar-AE",
      accent: "gulf",
      openaiVoice: "nova",
      elevenLabsVoiceId: ELEVEN.sarah,
    };
  }
  // Egypt / North Africa
  if (country && ["EG", "SD"].includes(country)) {
    return {
      speechLocale: "ar-EG",
      accent: "egyptian",
      openaiVoice: "nova",
      elevenLabsVoiceId: ELEVEN.sarah,
    };
  }
  if (country && ["MA", "DZ", "TN", "LY"].includes(country)) {
    return {
      speechLocale: "ar-MA",
      accent: "maghrebi",
      openaiVoice: "nova",
      elevenLabsVoiceId: ELEVEN.sarah,
    };
  }
  return {
    speechLocale: "ar-SA",
    accent: "msa",
    openaiVoice: "nova",
    elevenLabsVoiceId: ELEVEN.sarah,
  };
}

function englishAccent(country: string | null): {
  speechLocale: string;
  accent: string;
  openaiVoice: string;
  elevenLabsVoiceId: string;
} {
  if (country && ["GB", "IE"].includes(country)) {
    return {
      speechLocale: "en-GB",
      accent: "british",
      openaiVoice: "fable",
      elevenLabsVoiceId: ELEVEN.daniel,
    };
  }
  if (country && ["AU", "NZ"].includes(country)) {
    return {
      speechLocale: "en-AU",
      accent: "australian",
      openaiVoice: "shimmer",
      elevenLabsVoiceId: ELEVEN.lily,
    };
  }
  if (country && ["CA"].includes(country)) {
    return {
      speechLocale: "en-CA",
      accent: "canadian",
      openaiVoice: "alloy",
      elevenLabsVoiceId: ELEVEN.adam,
    };
  }
  return {
    speechLocale: "en-US",
    accent: "american",
    openaiVoice: "alloy",
    elevenLabsVoiceId: ELEVEN.adam,
  };
}

/**
 * Pick TTS + STT locale/voice from selected language + country.
 * Selected language always wins for content; country shapes accent/voice.
 */
export function resolveTeacherVoice(input: {
  language?: string | null;
  countryCode?: string | null;
  provinceName?: string | null;
  voiceOverride?: string | null;
}): ResolvedTeacherVoice {
  const selectedLanguage = normLang(input.language);
  const countryCode = normCountry(input.countryCode);
  const provinceName = (input.provinceName || "").trim() || null;
  const override = (input.voiceOverride || "").trim();

  if (selectedLanguage === "tr") {
    return {
      language: "tr",
      selectedLanguage,
      countryCode,
      provinceName,
      speechLocale: "tr-TR",
      openaiVoice: override || "onyx",
      elevenLabsVoiceId: override && override.length >= 16 ? override : ELEVEN.george,
      elevenLanguageCode: "tr",
      accent: "turkish",
    };
  }

  if (selectedLanguage === "ku") {
    const ar = arabicAccent(countryCode);
    const inTurkey = countryCode === "TR";
    return {
      language: inTurkey ? "tr" : "ar",
      selectedLanguage,
      countryCode,
      provinceName,
      speechLocale: inTurkey ? "tr-TR" : countryCode === "IQ" ? "ar-IQ" : ar.speechLocale,
      openaiVoice: override || (inTurkey ? "onyx" : ar.openaiVoice),
      elevenLabsVoiceId:
        override && override.length >= 16
          ? override
          : inTurkey
            ? ELEVEN.george
            : ar.elevenLabsVoiceId,
      elevenLanguageCode: inTurkey ? "tr" : "ar",
      accent: inTurkey ? "kurdish_tr_context" : "kurdish_iq_context",
    };
  }

  if (selectedLanguage === "ar") {
    const ar = arabicAccent(countryCode);
    // Province can refine Iraqi Arabic teaching tone without changing voice id.
    const accent =
      countryCode === "IQ" && provinceName
        ? `iraqi_${provinceName.toLowerCase().replace(/\s+/g, "_").slice(0, 24)}`
        : ar.accent;
    return {
      language: "ar",
      selectedLanguage,
      countryCode,
      provinceName,
      speechLocale: ar.speechLocale,
      openaiVoice: override || ar.openaiVoice,
      elevenLabsVoiceId:
        override && override.length >= 16 ? override : ar.elevenLabsVoiceId,
      elevenLanguageCode: "ar",
      accent,
    };
  }

  const en = englishAccent(countryCode);
  return {
    language: "en",
    selectedLanguage: "en",
    countryCode,
    provinceName,
    speechLocale: en.speechLocale,
    openaiVoice: override || en.openaiVoice,
    elevenLabsVoiceId:
      override && override.length >= 16 ? override : en.elevenLabsVoiceId,
    elevenLanguageCode: "en",
    accent: en.accent,
  };
}

/** Prompt hint so the teacher writes/speaks in the right language + regional tone. */
export function accentInstruction(
  language?: string | null,
  countryCode?: string | null,
  provinceName?: string | null
): string {
  const v = resolveTeacherVoice({ language, countryCode, provinceName });
  const region = [
    v.countryCode ? `country ${v.countryCode}` : null,
    v.provinceName ? `province ${v.provinceName}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const tag = region ? ` (${region})` : "";
  const shared =
    "Sound like a senior professional teacher: warm, clear, confident, never robotic. Prefer natural classroom rhythm with gentle pauses.";
  switch (v.selectedLanguage) {
    case "ar":
      if (v.accent.startsWith("iraqi") || v.accent === "iraqi_levantine") {
        return [
          `Speak and write entirely in clear Arabic (فصحى مبسّطة) with a natural Iraqi classroom tone${tag}.`,
          "Use familiar Iraqi educational expressions when helpful (e.g. خلّينا، زين، شوفوا، تمام) without becoming slangy or unclear.",
          "Pronounce carefully for students; keep sentences short and musical.",
          shared,
          "Never switch language unless asked.",
        ].join(" ");
      }
      if (v.accent === "levantine") {
        return [
          `Speak and write entirely in clear Arabic with a Levantine-friendly teaching tone${tag}.`,
          "Keep MSA clarity with warm Levantine classroom flavor.",
          shared,
          "Never switch language unless asked.",
        ].join(" ");
      }
      if (v.accent === "gulf") {
        return [
          `Speak and write entirely in clear Arabic with a polished Gulf educational tone${tag}.`,
          "Stay respectful, clear, and classroom-professional.",
          shared,
          "Never switch language unless asked.",
        ].join(" ");
      }
      if (v.accent === "egyptian") {
        return [
          `Speak and write entirely in clear Arabic with an Egyptian-friendly teaching tone${tag}.`,
          "Warm and engaging, but still academically precise.",
          shared,
          "Never switch language unless asked.",
        ].join(" ");
      }
      return `Speak and write entirely in Arabic (العربية)${tag}. ${shared} Do not switch to English unless the user asks.`;
    case "ku":
      return `You MUST reply entirely in Kurdish (کوردی)${tag}. Keep explanations natural and professional for students in this region. ${shared} Do not switch language unless asked.`;
    case "tr":
      return `Speak and write entirely in natural classroom Turkish${tag}. Clear diction, warm teacher energy, professional vocabulary. ${shared} Do not switch language unless asked.`;
    default:
      if (v.accent === "british") {
        return `Speak and write entirely in English with British spelling/examples${tag}. Polished classroom English. ${shared}`;
      }
      if (v.accent === "australian") {
        return `Speak and write entirely in English with Australian-friendly examples${tag}. Clear professional classroom English. ${shared}`;
      }
      return `Speak and write entirely in clear professional classroom English${tag}. ${shared}`;
  }
}

/** Short delivery instruction for TTS engines that support style prompts. */
export function ttsDeliveryInstruction(
  language?: string | null,
  countryCode?: string | null,
  provinceName?: string | null,
  pace?: "slow" | "normal" | "brisk" | null
): string {
  const v = resolveTeacherVoice({ language, countryCode, provinceName });
  const paceHint =
    pace === "slow"
      ? "Speak slowly and patiently, with clear pauses between ideas."
      : pace === "brisk"
        ? "Speak with energetic, confident classroom pace — still clear."
        : "Speak at a natural teacher pace with gentle emphasis.";
  const accentHint =
    v.selectedLanguage === "ar"
      ? `Use a professional ${v.accent.replace(/_/g, " ")} Arabic classroom accent. Warm, clear, never robotic.`
      : v.selectedLanguage === "tr"
        ? "Use a clear professional Turkish classroom voice."
        : `Use a professional ${v.accent} English classroom voice.`;
  return [
    "You are a world-class human teacher speaking live in class.",
    accentHint,
    paceHint,
    "Sound human: soft emphasis, natural breath, no chatbot cadence.",
  ].join(" ");
}
