import { readFile } from "fs/promises";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont, PDFPage, RGB } from "pdf-lib";
import { StandardFonts, rgb } from "pdf-lib";
// arabic-reshaper is CJS
import ArabicReshaper from "arabic-reshaper";
import bidiFactory from "bidi-js";

const bidi = bidiFactory();

const ARABIC_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_CHAR_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

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
 * Do NOT use this for SVG/HTML/PPT — those engines shape OpenType themselves.
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

export type EmbeddedFonts = {
  /** Arabic (Noto Naskh) — presentation forms + Arabic letters */
  arabic: PDFFont;
  /** Latin/math/punctuation (Noto Sans or Helvetica) */
  latin: PDFFont;
  /** Alias used by older call sites — prefers Arabic when RTL */
  regular: PDFFont;
  bold: PDFFont;
  rtl: boolean;
};

function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Pick a font that can encode this character (Arabic font first for Arabic script). */
export function fontForChar(ch: string, fonts: EmbeddedFonts): PDFFont {
  const isAr = ARABIC_CHAR_RE.test(ch);
  if (isAr) {
    if (canEncode(fonts.arabic, ch)) return fonts.arabic;
    if (canEncode(fonts.latin, ch)) return fonts.latin;
    return fonts.arabic;
  }
  if (canEncode(fonts.latin, ch)) return fonts.latin;
  if (canEncode(fonts.arabic, ch)) return fonts.arabic;
  return fonts.latin;
}

export function measurePdfText(
  visual: string,
  fonts: EmbeddedFonts,
  size: number
): number {
  let w = 0;
  for (const ch of [...visual]) {
    const f = fontForChar(ch, fonts);
    if (!canEncode(f, ch)) continue;
    w += f.widthOfTextAtSize(ch, size);
  }
  return w;
}

/**
 * Draw a visual (already reshaped+reordered) line with dual fonts so
 * Arabic + Latin math like f(x)=ax+b both render instead of tofu boxes.
 */
export function drawPdfTextLine(
  page: PDFPage,
  visual: string,
  opts: {
    fonts: EmbeddedFonts;
    size: number;
    x: number;
    y: number;
    color?: RGB;
  }
): number {
  const color = opts.color ?? rgb(0.08, 0.1, 0.16);
  let x = opts.x;
  for (const ch of [...visual]) {
    const f = fontForChar(ch, opts.fonts);
    if (!canEncode(f, ch)) continue;
    const w = f.widthOfTextAtSize(ch, opts.size);
    page.drawText(ch, {
      x,
      y: opts.y,
      size: opts.size,
      font: f,
      color,
    });
    x += w;
  }
  return x - opts.x;
}

/**
 * Wrap logical text to fit maxWidth using dual-font measurement,
 * then return visual lines for pdf-lib.
 */
export function wrapPdfLines(
  logicalText: string,
  fonts: EmbeddedFonts,
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
      if (
        measurePdfText(test, fonts, size) > maxWidth &&
        line
      ) {
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
      measurePdfText(visual, fonts, size) > maxWidth
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

/** @deprecated Prefer wrapPdfLines(logical, fonts, size, maxWidth) */
export function wrapPdfLinesLegacy(
  logicalText: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const fake: EmbeddedFonts = {
    arabic: font,
    latin: font,
    regular: font,
    bold: font,
    rtl: hasArabicScript(logicalText),
  };
  return wrapPdfLines(logicalText, fake, size, maxWidth);
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

/**
 * Embed Unicode fonts when the document needs Arabic/Kurdish; otherwise Helvetica.
 * Always pair Noto Naskh (Arabic) + Noto Sans (Latin/math) — Naskh alone lacks
 * ASCII letters, so f(x)=ax+b became missing-glyph boxes in older exports.
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
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    return { arabic: regular, latin: regular, regular, bold, rtl: false };
  }

  pdf.registerFontkit(fontkit as never);
  const arabicBytes = await loadFontBytes("NotoNaskhArabic-Regular.ttf");
  const latinBytes = await loadFontBytes("NotoSans-Regular.ttf");

  let arabic: PDFFont;
  let latin: PDFFont;

  if (arabicBytes) {
    // subset:false — fontkit subsetting drops Arabic presentation-form glyphs
    arabic = await pdf.embedFont(arabicBytes, { subset: false });
  } else {
    arabic = await pdf.embedFont(StandardFonts.Helvetica);
  }

  if (latinBytes) {
    // Latin can subset safely (ASCII math / punctuation only)
    latin = await pdf.embedFont(latinBytes, { subset: true });
  } else {
    latin = await pdf.embedFont(StandardFonts.Helvetica);
  }

  return {
    arabic,
    latin,
    regular: arabic,
    bold: arabic,
    rtl: true,
  };
}

export function pptTextOptions(
  language?: string | null,
  extra?: Record<string, unknown>
) {
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
