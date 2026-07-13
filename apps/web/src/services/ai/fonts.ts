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

/**
 * Shape + reorder Arabic/Kurdish for pdf-lib (draws glyphs LTR).
 * Call this on each *logical* line AFTER wrapping — never wrap the visual string.
 */
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

/**
 * Wrap logical text to fit maxWidth, then return visual lines for pdf-lib.
 * Wrapping the already-reordered string reverses Arabic word order (broken PDFs).
 */
export function wrapPdfLines(
  logicalText: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const raw = logicalText.replace(/\s+/g, " ").trim();
  if (!raw) return [];

  if (!hasArabicScript(raw)) {
    const words = raw.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  const words = raw.split(" ");
  const logicalLines: string[] = [];
  let current: string[] = [];
  for (const w of words) {
    const candidate = [...current, w];
    const visual = preparePdfText(candidate.join(" "));
    if (
      current.length > 0 &&
      font.widthOfTextAtSize(visual, size) > maxWidth
    ) {
      logicalLines.push(current.join(" "));
      current = [w];
    } else {
      current = candidate;
    }
  }
  if (current.length) logicalLines.push(current.join(" "));

  return logicalLines.map((line) => preparePdfText(line));
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
 * Arabic must use subset:false — fontkit subsetting drops presentation-form glyphs.
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
    return {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      rtl: true,
    };
  }
  const regular = await pdf.embedFont(bytes, { subset: false });
  const bold = regular;
  return { regular, bold, rtl: true };
}

export function pptTextOptions(language?: string | null, extra?: Record<string, unknown>) {
  const rtl = isRtlLanguage(language);
  // Never pre-reshape for PPT — PowerPoint/Keynote apply OpenType shaping.
  return {
    fontFace: "Arial",
    ...(rtl
      ? {
          rtlMode: true,
          lang: "ar",
          align: "right" as const,
        }
      : { align: "left" as const }),
    ...extra,
  };
}

/**
 * FLUX paints pixels — Arabic glyphs usually break.
 * Instruct shape-only art; burn real Noto labels after (arabic-image-text.ts).
 */
export function fluxVisibleTextGuidance(
  language?: string | null,
  sampleText?: string
): string {
  const needsArabic =
    hasArabicScript(sampleText || "") || isRtlLanguage(language);
  if (!needsArabic) {
    return [
      `Visible labels language: ${language || "en"}.`,
      "Keep any text short, sharp, and high-contrast.",
    ].join(" ");
  }
  return [
    "CRITICAL — ARABIC TEXT POLICY:",
    "- Do NOT paint any Arabic, Kurdish, or RTL letters in the image (FLUX corrupts Arabic glyphs).",
    "- Draw shapes, diagrams, arrows, icons, and color regions only.",
    "- You may use small Latin letters A/B/C or numbers 1/2/3 as markers if needed.",
    "- Leave a clean empty margin at the bottom (~15%) for professional typography overlay.",
    "- High-contrast educational textbook style.",
  ].join("\n");
}
