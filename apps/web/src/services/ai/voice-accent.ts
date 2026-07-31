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
  /** Fish Audio voice model id (reference_id) */
  fishAudioVoiceId: string;
  /** Human-readable accent key for prompts / debugging */
  accent: string;
};

/** Public Fish Audio Voice Library ids used as classroom defaults. */
const FISH = {
  /** Clear multilingual female teacher (docs example) */
  teacher: "802e3bc2b27e49c2995d23ef70e6ac89",
  /** Warm narration / male (docs example) */
  narrator: "933563129e564b19a115bedd57b7406a",
} as const;

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

export function normLang(raw?: string | null): TeacherSpeechLanguage {
  const lang = (raw || "en").toLowerCase().slice(0, 2);
  if (lang === "ar") return "ar";
  if (lang === "ku") return "ku";
  if (lang === "tr") return "tr";
  return "en";
}

/**
 * The language the teacher must SPEAK/WRITE for this student.
 * Kurdish UI maps to Arabic or Turkish because classroom TTS has no KU voice —
 * the LLM must match the TTS language or the student hears "unknown"/garbled speech.
 */
export function classroomSpeechLanguage(input: {
  language?: string | null;
  countryCode?: string | null;
  provinceName?: string | null;
}): "ar" | "tr" | "en" {
  const v = resolveTeacherVoice(input);
  if (v.language === "ar" || v.language === "tr") return v.language;
  return "en";
}

/** Hard language lock for the top of every classroom system + user prompt. */
export function classroomLanguageLock(input: {
  language?: string | null;
  countryCode?: string | null;
  provinceName?: string | null;
}): string {
  const v = resolveTeacherVoice(input);
  const speech = classroomSpeechLanguage(input);
  const name =
    speech === "ar" ? "Arabic (العربية)" : speech === "tr" ? "Turkish" : "English";
  const kuNote =
    v.selectedLanguage === "ku"
      ? speech === "tr"
        ? " Student UI is Kurdish, but you MUST teach in Turkish so the classroom voice can speak clearly."
        : " Student UI is Kurdish, but you MUST teach in Arabic so the classroom voice can speak clearly."
      : "";
  return [
    `LANGUAGE LOCK (absolute — overrides every other instruction):`,
    `- Every speak[] line MUST be entirely in ${name}.${kuNote}`,
    `- Every board write_text label MUST be in ${name}.`,
    `- askStudent (when allowed) MUST be in ${name}.`,
    `- SOURCE MATERIAL may be in another language — TRANSLATE and teach the ideas in ${name}. Never mirror the PDF's language if it differs.`,
    `- Never mix languages in one beat. Never reply in English unless the speech language above is English.`,
    accentInstruction(input.language, input.countryCode, input.provinceName),
  ].join("\n");
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
  fishAudioVoiceId: string;
} {
  // Levant / Iraq
  if (country && ["IQ", "SY", "JO", "LB", "PS", "YE"].includes(country)) {
    return {
      speechLocale: country === "IQ" ? "ar-IQ" : "ar-JO",
      accent: country === "IQ" ? "iraqi_levantine" : "levantine",
      openaiVoice: "nova",
      elevenLabsVoiceId: ELEVEN.sarah,
      fishAudioVoiceId: FISH.teacher,
    };
  }
  // Gulf
  if (country && ["SA", "AE", "KW", "QA", "BH", "OM"].includes(country)) {
    return {
      speechLocale: country === "SA" ? "ar-SA" : "ar-AE",
      accent: "gulf",
      openaiVoice: "nova",
      elevenLabsVoiceId: ELEVEN.sarah,
      fishAudioVoiceId: FISH.teacher,
    };
  }
  // Egypt / North Africa
  if (country && ["EG", "SD"].includes(country)) {
    return {
      speechLocale: "ar-EG",
      accent: "egyptian",
      openaiVoice: "nova",
      elevenLabsVoiceId: ELEVEN.sarah,
      fishAudioVoiceId: FISH.teacher,
    };
  }
  if (country && ["MA", "DZ", "TN", "LY"].includes(country)) {
    return {
      speechLocale: "ar-MA",
      accent: "maghrebi",
      openaiVoice: "nova",
      elevenLabsVoiceId: ELEVEN.sarah,
      fishAudioVoiceId: FISH.teacher,
    };
  }
  return {
    speechLocale: "ar-SA",
    accent: "msa",
    openaiVoice: "nova",
    elevenLabsVoiceId: ELEVEN.sarah,
    fishAudioVoiceId: FISH.teacher,
  };
}

function englishAccent(country: string | null): {
  speechLocale: string;
  accent: string;
  openaiVoice: string;
  elevenLabsVoiceId: string;
  fishAudioVoiceId: string;
} {
  if (country && ["GB", "IE"].includes(country)) {
    return {
      speechLocale: "en-GB",
      accent: "british",
      openaiVoice: "fable",
      elevenLabsVoiceId: ELEVEN.daniel,
      fishAudioVoiceId: FISH.narrator,
    };
  }
  if (country && ["AU", "NZ"].includes(country)) {
    return {
      speechLocale: "en-AU",
      accent: "australian",
      openaiVoice: "shimmer",
      elevenLabsVoiceId: ELEVEN.lily,
      fishAudioVoiceId: FISH.teacher,
    };
  }
  if (country && ["CA"].includes(country)) {
    return {
      speechLocale: "en-CA",
      accent: "canadian",
      openaiVoice: "alloy",
      elevenLabsVoiceId: ELEVEN.adam,
      fishAudioVoiceId: FISH.narrator,
    };
  }
  return {
    speechLocale: "en-US",
    accent: "american",
    openaiVoice: "alloy",
    elevenLabsVoiceId: ELEVEN.adam,
    fishAudioVoiceId: FISH.narrator,
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
      fishAudioVoiceId:
        override && /^[a-f0-9]{24,}$/i.test(override) ? override : FISH.narrator,
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
      fishAudioVoiceId:
        override && /^[a-f0-9]{24,}$/i.test(override)
          ? override
          : inTurkey
            ? FISH.narrator
            : ar.fishAudioVoiceId,
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
      fishAudioVoiceId:
        override && /^[a-f0-9]{24,}$/i.test(override)
          ? override
          : ar.fishAudioVoiceId,
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
    fishAudioVoiceId:
      override && /^[a-f0-9]{24,}$/i.test(override)
        ? override
        : en.fishAudioVoiceId,
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
  const arabicDiacritics =
    "For clear pronunciation: add Arabic diacritics (تشكيل) on speak[] lines wherever helpful — especially technical terms and short words that TTS often misreads. Prefer readable vocalized Arabic over bare text. Keep board text short and diacritic-free for clean visuals.";
  switch (v.selectedLanguage) {
    case "ar":
      if (v.accent.startsWith("iraqi") || v.accent === "iraqi_levantine") {
        return [
          `Speak and write entirely in clear Arabic (فصحى مبسّطة) with a natural Iraqi classroom tone${tag}.`,
          "Use familiar Iraqi educational expressions when helpful (e.g. خلّينا، زين، شوفوا، تمام) without becoming slangy or unclear.",
          "Pronounce carefully for students; keep sentences short and musical.",
          arabicDiacritics,
          shared,
          "Never switch language unless asked.",
        ].join(" ");
      }
      if (v.accent === "levantine") {
        return [
          `Speak and write entirely in clear Arabic with a Levantine-friendly teaching tone${tag}.`,
          "Keep MSA clarity with warm Levantine classroom flavor.",
          arabicDiacritics,
          shared,
          "Never switch language unless asked.",
        ].join(" ");
      }
      if (v.accent === "gulf") {
        return [
          `Speak and write entirely in clear Arabic with a polished Gulf educational tone${tag}.`,
          "Stay respectful, clear, and classroom-professional.",
          arabicDiacritics,
          shared,
          "Never switch language unless asked.",
        ].join(" ");
      }
      if (v.accent === "egyptian") {
        return [
          `Speak and write entirely in clear Arabic with an Egyptian-friendly teaching tone${tag}.`,
          "Warm and engaging, but still academically precise.",
          arabicDiacritics,
          shared,
          "Never switch language unless asked.",
        ].join(" ");
      }
      return `Speak and write entirely in Arabic (العربية)${tag}. ${arabicDiacritics} ${shared} Do not switch to English unless the user asks.`;
    case "ku": {
      // TTS has no Kurdish voice — content must match delivery language.
      const speech = v.language === "tr" ? "tr" : "ar";
      if (speech === "tr") {
        return [
          `Student UI is Kurdish, but you MUST speak and write entirely in natural classroom Turkish${tag} so the voice engine can deliver it.`,
          "Use a warm Kurdish-region teaching tone in Turkish. Keep explanations clear and professional.",
          shared,
          "Do not write Kurdish script in speak[] or board text — Turkish only.",
        ].join(" ");
      }
      return [
        `Student UI is Kurdish, but you MUST speak and write entirely in clear Arabic${tag} so the voice engine can deliver it.`,
        "Use a warm Kurdish-region classroom tone in Arabic (فصحى مبسّطة with familiar local flavor when helpful).",
        arabicDiacritics,
        shared,
        "Do not write Kurdish script in speak[] or board text — Arabic only.",
      ].join(" ");
    }
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

export type ClassroomBridgeKind =
  | "think"
  | "explain"
  | "listen"
  | "check"
  | "reexplain"
  | "excellent";

/** Maps a short spoken bridge to the emotion its delivery should carry. */
export function bridgeKindToEmotion(kind: ClassroomBridgeKind): ClassroomVoiceEmotion {
  switch (kind) {
    case "excellent":
      return "encouraging";
    case "reexplain":
      return "patient";
    case "check":
      return "curious";
    case "listen":
      return "curious";
    default:
      return "calm";
  }
}

/**
 * Natural spoken bridge while the teacher prepares the next beat / answer.
 * Matches selected language + regional classroom accent.
 */
export function classroomBridgePhrase(
  language?: string | null,
  countryCode?: string | null,
  provinceName?: string | null,
  kind: ClassroomBridgeKind = "think",
  variant = 0
): string {
  const v = resolveTeacherVoice({ language, countryCode, provinceName });
  const i = Math.abs(variant) % 3;

  if (v.selectedLanguage === "ar") {
    const iraqi = v.accent.startsWith("iraqi") || v.accent === "iraqi_levantine";
    const gulf = v.accent === "gulf";
    const lev = v.accent === "levantine";
    const egy = v.accent === "egyptian";
    if (kind === "listen") {
      if (iraqi) return ["إي، سامعك", "تفضّل، أنا أسمعك", "زين، كمّل"][i]!;
      if (gulf) return ["تفضّل، أسمعك", "إي، كمّل", "حاضر، سامعك"][i]!;
      if (lev) return ["تفضّل، عم اسمعك", "إي كمّل", "حاضر"][i]!;
      if (egy) return ["اتفضل، سامعك", "كمّل يا بطل", "إي أنا سامعك"][i]!;
      return ["تفضل، أنا أستمع إليك", "حسنًا، أكمل", "أنا معك، تفضّل"][i]!;
    }
    if (kind === "check") {
      if (iraqi) return ["خلّيني أتأكد", "لحظة خلّيني أشيك الجواب", "زين، خلّيني أراجع جوابك"][i]!;
      if (gulf) return ["خلني أتأكد", "لحظة أشيك الجواب", "خلني أراجع جوابك"][i]!;
      if (lev) return ["خليني تأكد", "لحظة خليني شيّك الجواب", "خليني راجع جوابك"][i]!;
      if (egy) return ["سيبني أتأكد", "لحظة أشيك الإجابة", "سيبني أراجع جوابك"][i]!;
      return ["دعني أتأكد", "لحظة لأراجع الجواب", "دعني أتحقق من إجابتك"][i]!;
    }
    if (kind === "excellent") {
      if (iraqi) return ["ممتاز!", "زين جداً، أحسنت!", "جوابك صحيح، ممتاز!"][i]!;
      if (gulf) return ["ممتاز!", "أحسنت، زين!", "صحيح، ممتاز!"][i]!;
      if (lev) return ["ممتاز!", "يسلموا، أحسنت!", "صح، ممتاز!"][i]!;
      if (egy) return ["ممتاز!", "برافو عليك!", "صح، ممتاز يا بطل!"][i]!;
      return ["ممتاز!", "أحسنت!", "إجابة صحيحة، ممتاز!"][i]!;
    }
    if (kind === "reexplain") {
      if (iraqi) return ["خلّيني أشرح مرة ثانية", "زين، خلّيني أوضحها من جديد", "خلّيني نعيد الشرح بهدوء"][i]!;
      if (gulf) return ["خلني أشرح مرة ثانية", "خلني أوضحها من جديد", "خلنا نعيد الشرح بهدوء"][i]!;
      if (lev) return ["خليني اشرح مرة تانية", "خليني وضّحها من جديد", "خليني نعيد الشرح بهدوء"][i]!;
      if (egy) return ["سيبني أشرح تاني", "سيبني أوضحها من الأول", "تعالى نعيد الشرح بهدوء"][i]!;
      return ["دعني أشرح مرة أخرى", "دعني أوضحها من جديد", "لنُعِد الشرح بهدوء"][i]!;
    }
    if (kind === "explain") {
      if (iraqi) return ["خلّيني أوضح لك", "زين، خلّيني أشرحها بهدوء", "خلّيني أشرحلك الفكرة"][i]!;
      if (gulf) return ["خلني أوضح لك", "خلني أشرحها بهدوء", "خلنا نوضحها مع بعض"][i]!;
      if (lev) return ["خليني وضّحلك", "خليني اشرحلك بهدوء", "خليني بيّنلك الفكرة"][i]!;
      if (egy) return ["سيبني أوضحلك", "سيبني أشرحلك بهدوء", "تعالى نشرحها سوا"][i]!;
      return ["دعني أوضح لك", "دعني أشرح بهدوء", "لنوضّح الفكرة معًا"][i]!;
    }
    // think
    if (iraqi) return ["خلّيني أفكر شوية", "لحظة خلّيني أرتّب الفكرة", "خلّيني أشوفها وياك"][i]!;
    if (gulf) return ["خلني أفكر شوي", "لحظة أرتب الفكرة", "خلني أشوفها معك"][i]!;
    if (lev) return ["خليني فكر شوي", "لحظة خليني رتّب الفكرة", "خليني شوفها معك"][i]!;
    if (egy) return ["سيبني أفكر شوية", "لحظة أرتب الفكرة", "سيبني أشوفها معاك"][i]!;
    return ["دعني أفكر قليلاً", "لحظة حتى أرتّب الفكرة", "دعني أتأمل السؤال"][i]!;
  }

  if (v.selectedLanguage === "ku") {
    if (kind === "listen") return ["باشە، گوێت لێدەگرم", "بەردەوام بە", "من گوێم لێتە"][i]!;
    if (kind === "check") return ["با دڵنیا ببمەوە", "چرکەیەک با وەڵامەکە بپشکنم", "با وەڵامەکەت بپشکنم"][i]!;
    if (kind === "excellent") return ["نایاب!", "زۆر باش، ئافەرین!", "وەڵامەکەت دروستە، نایاب!"][i]!;
    if (kind === "reexplain") return ["با جارێکی تر ڕوونی بکەمەوە", "با لەسەرەتاوە ڕوونی بکەمەوە", "با دووبارە ڕوونی بکەینەوە"][i]!;
    if (kind === "explain") return ["با ڕوونت بکەمەوە", "با بە ئارامی ڕوونی بکەمەوە", "با پێکەوە ڕوونی بکەینەوە"][i]!;
    return ["با کەمێک بیر بکەمەوە", "چرکەیەک با بیر بکەمەوە", "با بیر لە وەڵام بکەمەوە"][i]!;
  }

  if (v.selectedLanguage === "tr") {
    if (kind === "listen") return ["Dinliyorum, buyur", "Seni dinliyorum", "Devam et lütfen"][i]!;
    if (kind === "check") return ["Kontrol edeyim", "Cevabını bir bakayım", "Bir kontrol edeyim"][i]!;
    if (kind === "excellent") return ["Mükemmel!", "Harika, aferin!", "Doğru cevap, mükemmel!"][i]!;
    if (kind === "reexplain") return ["Tekrar açıklayayım", "Baştan anlatayım", "Bir daha açıklayayım"][i]!;
    if (kind === "explain") return ["Açıklayayım", "Sakin sakin anlatayım", "Birlikte netleştirelim"][i]!;
    return ["Bir düşüneyim", "Bir saniye düşüneyim", "Cevabı bir toparlayayım"][i]!;
  }

  if (kind === "listen") {
    return ["I'm listening — go ahead", "Yes, I'm with you", "Go on, I'm listening"][i]!;
  }
  if (kind === "check") {
    return ["Let me check", "Let me check your answer", "One moment — let me check"][i]!;
  }
  if (kind === "excellent") {
    return ["Excellent!", "Excellent — well done!", "That's correct — excellent!"][i]!;
  }
  if (kind === "reexplain") {
    return ["Let me explain again", "Let me explain that again", "Okay — let me explain again"][i]!;
  }
  if (kind === "explain") {
    return ["Let me explain", "Let me walk you through it", "Let me make this clear"][i]!;
  }
  return ["Let me think for a moment", "One moment while I gather that", "Give me a second to think"][i]!;
}

export type ClassroomVoiceEmotion =
  | "calm"
  | "encouraging"
  | "curious"
  | "patient"
  | "energetic"
  | "frustrated"
  | "confused";

/**
 * How each emotional state should actually change vocal delivery — separate
 * from pace, so "energetic" and "frustrated" sound distinct even at the same
 * speaking speed. Without this, `emotion` was cosmetic: chosen by the model
 * but never reaching the voice engine.
 */
function emotionDeliveryHint(emotion?: string | null): string {
  switch ((emotion || "calm") as ClassroomVoiceEmotion) {
    case "encouraging":
      return "Warm, uplifting tone — like praising a student who just got something right.";
    case "curious":
      return "Bright, inquisitive tone, as if genuinely intrigued by the question.";
    case "energetic":
      return "Lively, confident, upbeat energy — a teacher excited to go further.";
    case "patient":
      return "Extra gentle and unhurried, softening every word, no impatience at all.";
    case "frustrated":
      return "Extra warm, slow, and reassuring — the student is struggling, so soften the voice and never sound impatient or annoyed.";
    case "confused":
      return "Deliberate and calm, articulating each word clearly to rebuild clarity.";
    default:
      return "Steady, warm, composed classroom tone.";
  }
}

/** Short delivery instruction for TTS engines that support style prompts. */
export function ttsDeliveryInstruction(
  language?: string | null,
  countryCode?: string | null,
  provinceName?: string | null,
  pace?: "slow" | "normal" | "brisk" | null,
  emotion?: string | null
): string {
  const v = resolveTeacherVoice({ language, countryCode, provinceName });
  const paceHint =
    pace === "slow"
      ? "Speak slowly and patiently, with clear pauses between ideas, like sitting beside the student."
      : pace === "brisk"
        ? "Speak with energetic, confident classroom pace — alive, still crystal clear."
        : "Speak at a natural conversational teacher pace with gentle emphasis and easy rhythm.";
  // Use delivery language (v.language), not UI language — KU UI maps to ar/tr TTS.
  const accentHint =
    v.language === "ar"
      ? `Use a professional ${v.accent.replace(/_/g, " ")} Arabic classroom accent. Warm, clear, never robotic.`
      : v.language === "tr"
        ? "Use a clear professional Turkish classroom voice."
        : `Use a professional ${String(v.accent).replace(/_/g, " ")} English classroom voice.`;
  return [
    "You are a world-class human teacher speaking live, one-on-one with your student.",
    accentHint,
    paceHint,
    emotionDeliveryHint(emotion),
    "Deliver like natural conversation, not narration: micro-pauses where a human breathes, rising intonation on hooks and questions, soft emphasis on key words, a smile in the voice.",
    "Vary pitch and energy across sentences — never flat, never monotone, never chatbot cadence.",
  ].join(" ");
}

/**
 * Fish Audio S2 inline delivery cue for the student's country accent.
 * S2 reads natural-language tags in [square brackets] before the spoken text.
 * @see https://fish.audio/blog/fish-audio-s2-fine-grained-ai-voice-control-at-the-word-level/
 */
/** Short emotion descriptor appended to the Fish Audio S2 bracket cue. */
function emotionTagBit(emotion?: string | null): string {
  switch ((emotion || "calm") as ClassroomVoiceEmotion) {
    case "encouraging":
      return "warm encouraging tone with a smile in the voice";
    case "curious":
      return "bright curious tone, rising intonation on hooks";
    case "energetic":
      return "lively upbeat energy, expressive pitch variation";
    case "patient":
      return "extra gentle unhurried tone, soft reassuring delivery";
    case "frustrated":
      return "extra warm reassuring tone, never impatient";
    case "confused":
      return "deliberate calm tone, clear articulation";
    default:
      return "steady warm conversational tone";
  }
}

export function fishAccentSpeechTag(
  language?: string | null,
  countryCode?: string | null,
  provinceName?: string | null,
  pace?: "slow" | "normal" | "brisk" | null,
  emotion?: string | null
): string {
  const v = resolveTeacherVoice({ language, countryCode, provinceName });
  const paceBit =
    pace === "slow"
      ? "slow patient pace with natural breathing pauses"
      : pace === "brisk"
        ? "energetic clear pace, expressive and alive"
        : "natural conversational teacher pace with human breathing";
  const emoBit = emotionTagBit(emotion);

  if (v.selectedLanguage === "ar") {
    if (v.accent.startsWith("iraqi") || v.accent === "iraqi_levantine") {
      return `[warm professional Iraqi Arabic classroom accent, ${paceBit}, ${emoBit}, clear diction]`;
    }
    if (v.accent === "levantine") {
      return `[warm Levantine Arabic classroom accent, ${paceBit}, ${emoBit}, clear diction]`;
    }
    if (v.accent === "gulf") {
      return `[polished Gulf Arabic educational accent, ${paceBit}, ${emoBit}, respectful and clear]`;
    }
    if (v.accent === "egyptian") {
      return `[warm Egyptian Arabic teaching accent, ${paceBit}, ${emoBit}, engaging and clear]`;
    }
    if (v.accent === "maghrebi") {
      return `[clear Maghrebi Arabic classroom accent leaning MSA, ${paceBit}, ${emoBit}]`;
    }
    return `[clear Modern Standard Arabic classroom accent, ${paceBit}, ${emoBit}]`;
  }
  if (v.selectedLanguage === "tr") {
    return `[clear professional Turkish classroom teacher accent, ${paceBit}, ${emoBit}]`;
  }
  if (v.selectedLanguage === "ku") {
    return v.countryCode === "TR"
      ? `[clear Turkish classroom teacher accent, ${paceBit}, ${emoBit}]`
      : `[warm professional Iraqi Arabic classroom accent, ${paceBit}, ${emoBit}]`;
  }
  if (v.accent === "british") {
    return `[polished British English classroom accent, ${paceBit}, ${emoBit}]`;
  }
  if (v.accent === "australian") {
    return `[clear Australian English classroom accent, ${paceBit}, ${emoBit}]`;
  }
  if (v.accent === "canadian") {
    return `[clear Canadian English classroom accent, ${paceBit}, ${emoBit}]`;
  }
  return `[clear American English classroom accent, ${paceBit}, ${emoBit}]`;
}

/** Prefixed spoken text so Fish Audio S2 delivers the student's regional accent + emotion. */
export function withFishAccentSpeech(
  text: string,
  language?: string | null,
  countryCode?: string | null,
  provinceName?: string | null,
  pace?: "slow" | "normal" | "brisk" | null,
  emotion?: string | null
): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const tag = fishAccentSpeechTag(language, countryCode, provinceName, pace, emotion);
  if (trimmed.startsWith("[")) return trimmed;
  return `${tag} ${trimmed}`;
}
