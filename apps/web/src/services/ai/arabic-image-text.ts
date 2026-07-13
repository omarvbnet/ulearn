import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import {
  hasArabicScript,
  isRtlLanguage,
  preparePdfText,
  fluxVisibleTextGuidance,
} from "./fonts";

let fontPathCache: Promise<string | null> | null = null;

async function resolveNotoPath(): Promise<string | null> {
  if (!fontPathCache) {
    fontPathCache = (async () => {
      const candidates = [
        path.join(process.cwd(), "assets", "fonts", "NotoNaskhArabic-Regular.ttf"),
        path.join(
          process.cwd(),
          "apps",
          "web",
          "assets",
          "fonts",
          "NotoNaskhArabic-Regular.ttf"
        ),
      ];
      for (const p of candidates) {
        try {
          await readFile(p);
          return p;
        } catch {
          /* try next */
        }
      }
      return null;
    })();
  }
  return fontPathCache;
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pull short Arabic (or quoted) labels from prompts / FLUX blocks. */
export function extractEducationalLabels(text: string): string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 80) return;
    if (!found.includes(t)) found.push(t);
  };

  const labelsLine = text.match(/LABELS?\s*[:：]\s*([^\n\[]+)/i);
  if (labelsLine?.[1]) {
    for (const part of labelsLine[1].split(/[|،,;/]+/)) push(part);
  }

  for (const m of text.matchAll(/[«"“']([^«"“'\n]{2,80})[»"”']/g)) {
    if (m[1] && hasArabicScript(m[1])) push(m[1]);
  }

  for (const m of text.matchAll(
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF][\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s\u064B-\u065F]{1,60}/g
  )) {
    push(m[0]);
  }

  return found.slice(0, 8);
}

export function parseFluxBlock(inner: string): {
  prompt: string;
  labels: string[];
} {
  const labels = extractEducationalLabels(inner);
  const prompt = inner
    .replace(/LABELS?\s*[:：]\s*[^\n\[]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { prompt: prompt || inner.trim(), labels };
}

/** Alias — FLUX shape-only policy lives in fonts.fluxVisibleTextGuidance. */
export const fluxShapeOnlyGuidance = fluxVisibleTextGuidance;

/**
 * Composite a professional Arabic caption strip onto a PNG using Noto Naskh
 * via sharp + SVG (Turbopack-safe; no @napi-rs/canvas).
 * Returns base64 PNG (no data: prefix).
 */
export async function burnArabicTypographyOntoPng(
  pngBase64: string,
  opts: {
    title?: string;
    labels?: string[];
    language?: string | null;
  }
): Promise<string> {
  const title = (opts.title || "").trim();
  const labels = (opts.labels || []).map((l) => l.trim()).filter(Boolean);
  const needOverlay =
    isRtlLanguage(opts.language) ||
    hasArabicScript(title) ||
    labels.some((l) => hasArabicScript(l));

  const rawB64 = pngBase64.replace(/^data:[^;]+;base64,/, "");
  if (!needOverlay && !title && !labels.length) {
    return rawB64;
  }

  try {
    const raw = Buffer.from(rawB64, "base64");
    const meta = await sharp(raw).metadata();
    const w = meta.width || 1024;
    const h = meta.height || 1024;
    const stripH = Math.max(72, Math.round(h * 0.16));
    const rtl =
      isRtlLanguage(opts.language) ||
      hasArabicScript(title + labels.join(""));

    const fontPath = await resolveNotoPath();
    // Prefer file:// over huge data-URI fonts (librsvg can hang on embedded TTF).
    const fontFace = fontPath
      ? `@font-face{font-family:'NotoNaskhArabic';src:url('file://${fontPath.replace(/\\/g, "/")}');}`
      : "";

    const displayTitle = title
      ? escapeXml(preparePdfText(title.slice(0, 90)))
      : "";
    const labelLine = labels.length
      ? escapeXml(
          preparePdfText(labels.slice(0, 6).join(rtl ? "  ·  " : "  ·  ").slice(0, 140))
        )
      : !title && needOverlay
        ? escapeXml(
            preparePdfText(
              (opts.language || "").startsWith("ar")
                ? "رسم تعليمي"
                : "Educational diagram"
            )
          )
        : "";

    const anchor = rtl ? "end" : "start";
    const x = rtl ? w - 28 : 28;
    const titleSize = Math.max(18, Math.round(w * 0.028));
    const labelSize = Math.max(14, Math.round(w * 0.022));
    const titleY = Math.round(stripH * 0.42);
    const labelY = Math.round(stripH * 0.72);

    const stripSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${stripH}" xmlns="http://www.w3.org/2000/svg">
  <defs><style type="text/css"><![CDATA[
    ${fontFace}
    .ar { font-family: 'NotoNaskhArabic', 'Arial', sans-serif; fill: #0f172a; }
  ]]></style></defs>
  <rect width="${w}" height="${stripH}" fill="#ffffff"/>
  <rect width="${w}" height="2" fill="#e2e8f0"/>
  ${
    displayTitle
      ? `<text class="ar" x="${x}" y="${titleY}" font-size="${titleSize}" font-weight="600" text-anchor="${anchor}">${displayTitle}</text>`
      : ""
  }
  ${
    labelLine
      ? `<text class="ar" x="${x}" y="${labelY}" font-size="${labelSize}" text-anchor="${anchor}">${labelLine}</text>`
      : ""
  }
</svg>`;

    const stripPng = await sharp(Buffer.from(stripSvg)).png().toBuffer();
    const out = await sharp(raw)
      .extend({
        top: 0,
        bottom: stripH,
        left: 0,
        right: 0,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .composite([{ input: stripPng, top: h, left: 0 }])
      .png()
      .toBuffer();

    return out.toString("base64");
  } catch (e) {
    console.warn(
      "[arabic-image-text] overlay failed — returning original PNG",
      e instanceof Error ? e.message : e
    );
    return rawB64;
  }
}

/** Safe SVG escape helper for callers that build markup. */
export function xmlEscape(s: string) {
  return escapeXml(s);
}
