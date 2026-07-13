import { readFile } from "fs/promises";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";
import { StandardFonts } from "pdf-lib";
// arabic-reshaper is CJS
import ArabicReshaper from "arabic-reshaper";
import bidiFactory from "bidi-js";

const bidi = bidiFactory();

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function hasArabicScript(text: string): boolean {
  return ARABIC_RE.test(text);
}

export function isRtlLanguage(language?: string | null): boolean {
  const lang = (language || "").toLowerCase().slice(0, 2);
  return lang === "ar" || lang === "ku";
}

/** Shape + reorder Arabic/Kurdish for pdf-lib left-to-right glyph drawing. */
export function preparePdfText(text: string): string {
  if (!hasArabicScript(text)) return text;
  try {
    const reshaped = ArabicReshaper.convertArabic(text);
    const levels = bidi.getEmbeddingLevels(reshaped);
    return bidi.getReorderedString(reshaped, levels);
  } catch {
    return text;
  }
}

async function loadFontBytes(fileName: string): Promise<Uint8Array | null> {
  const candidates = [
    path.join(process.cwd(), "assets", "fonts", fileName),
    path.join(process.cwd(), "apps", "web", "assets", "fonts", fileName),
  ];
  for (const p of candidates) {
    try {
      return new Uint8Array(await readFile(p));
    } catch {
      /* try next */
    }
  }
  return null;
}

export type EmbeddedFonts = {
  regular: PDFFont;
  bold: PDFFont;
  rtl: boolean;
};

/**
 * Embed Unicode fonts when the document needs Arabic/Kurdish; otherwise Helvetica.
 */
export async function embedDocumentFonts(
  pdf: PDFDocument,
  sampleText: string,
  language?: string | null
): Promise<EmbeddedFonts> {
  const needUnicode =
    hasArabicScript(sampleText) || isRtlLanguage(language);

  if (!needUnicode) {
    return {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      rtl: false,
    };
  }

  pdf.registerFontkit(fontkit as never);
  const arabicBytes = await loadFontBytes("NotoNaskhArabic-Regular.ttf");
  const latinBytes = await loadFontBytes("NotoSans-Regular.ttf");
  const bytes = arabicBytes || latinBytes;
  if (!bytes) {
    // Last resort — will still fail on Arabic glyphs, but avoid crash if fonts missing.
    return {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      rtl: true,
    };
  }
  const regular = await pdf.embedFont(bytes, { subset: true });
  // Same file as bold fallback (no separate bold file shipped).
  const bold = regular;
  return { regular, bold, rtl: true };
}

export function pptTextOptions(language?: string | null, extra?: Record<string, unknown>) {
  const rtl = isRtlLanguage(language);
  return {
    fontFace: rtl ? "Arial" : "Arial",
    ...(rtl
      ? { rtlMode: true, lang: language?.startsWith("ku") ? "ar" : "ar", align: "right" as const }
      : { align: "left" as const }),
    ...extra,
  };
}

/**
 * Prompt rules so FLUX (and similar) render Arabic/Kurdish labels correctly.
 * Raster models do not embed our Noto fonts — guidance must be in the prompt.
 */
export function fluxVisibleTextGuidance(
  language?: string | null,
  sampleText?: string
): string {
  const lang = (language || "en").toLowerCase().slice(0, 2);
  const needsArabic =
    hasArabicScript(sampleText || "") || lang === "ar" || lang === "ku";
  if (!needsArabic) {
    return [
      `Visible labels language: ${language || "en"}.`,
      "Render text sharp, correctly spelled, high-contrast, never garbled.",
    ].join(" ");
  }
  return [
    "ARABIC / RTL TEXT (critical):",
    "- All student-facing labels MUST be correct Modern Standard Arabic (or Kurdish when requested), fully connected letters (no isolated glyphs).",
    "- Use a clear Naskh-style calligraphic look; never Latin lookalike characters standing in for Arabic.",
    "- Lay out Arabic right-to-left; keep short labels (2–6 words); large enough to read on a phone.",
    "- Do not mirror or reverse Arabic letter order; do not mix broken Latin transliteration into Arabic words.",
    "- Prefer shapes + arrows with Arabic captions over dense paragraphs.",
    `Language for visible text: ${language || "ar"}.`,
  ].join("\n");
}
