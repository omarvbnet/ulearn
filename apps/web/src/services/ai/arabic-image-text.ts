import { readFile } from "fs/promises";
import path from "path";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import {
  hasArabicScript,
  isRtlLanguage,
  fluxVisibleTextGuidance,
} from "./fonts";

let fontReady: Promise<string | null> | null = null;

async function resolveNotoPath(): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), "assets", "fonts", "NotoNaskhArabic-Regular.ttf"),
    path.join(process.cwd(), "apps", "web", "assets", "fonts", "NotoNaskhArabic-Regular.ttf"),
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
}

async function ensureArabicFont(): Promise<string | null> {
  if (!fontReady) {
    fontReady = (async () => {
      const p = await resolveNotoPath();
      if (p) {
        try {
          GlobalFonts.registerFromPath(p, "NotoNaskhArabic");
        } catch {
          /* already registered */
        }
      }
      return p;
    })();
  }
  return fontReady;
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

  const labelsLine = text.match(
    /LABELS?\s*[:：]\s*([^\n\[]+)/i
  );
  if (labelsLine?.[1]) {
    for (const part of labelsLine[1].split(/[|،,;/]+/)) push(part);
  }

  for (const m of text.matchAll(/[«"“']([^«"“'\n]{2,80})[»"”']/g)) {
    if (m[1] && (hasArabicScript(m[1]) || /[\u0600-\u06FF]/.test(m[1]))) {
      push(m[1]);
    }
  }

  // Standalone Arabic phrases (2–6 words)
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
 * Composite a professional Arabic caption strip onto a PNG using Noto Naskh.
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

  if (!needOverlay && !title && !labels.length) {
    return pngBase64.replace(/^data:[^;]+;base64,/, "");
  }

  const fontPath = await ensureArabicFont();
  const raw = Buffer.from(
    pngBase64.replace(/^data:[^;]+;base64,/, ""),
    "base64"
  );
  const img = await loadImage(raw);
  const w = img.width;
  const h = img.height;
  const stripH = Math.max(72, Math.round(h * 0.16));
  const canvas = createCanvas(w, h + stripH);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, w, h + stripH);
  ctx.drawImage(img, 0, 0, w, h);

  // Caption strip
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, h, w, stripH);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, h, w, 2);

  const fontFamily = fontPath ? "NotoNaskhArabic" : "sans-serif";
  const rtl = isRtlLanguage(opts.language) || hasArabicScript(title + labels.join(""));

  const drawLine = (text: string, y: number, size: number, bold = false) => {
    // Skia/HarfBuzz shapes Arabic via Noto — do NOT pre-reshape (that is for pdf-lib only).
    const display = text;
    ctx.font = `${bold ? "600" : "400"} ${size}px "${fontFamily}", "Arial", sans-serif`;
    ctx.fillStyle = "#0f172a";
    ctx.textBaseline = "middle";
    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.textAlign = rtl ? "right" : "left";
    const x = rtl ? w - 28 : 28;
    ctx.fillText(display, x, y, w - 56);
  };

  let y = h + Math.round(stripH * 0.38);
  if (title) {
    drawLine(title.slice(0, 90), y, Math.max(18, Math.round(w * 0.028)), true);
    y += Math.round(stripH * 0.32);
  }
  if (labels.length) {
    const line = labels.slice(0, 6).join(rtl ? "  ·  " : "  ·  ");
    drawLine(line.slice(0, 140), y, Math.max(14, Math.round(w * 0.022)), false);
  } else if (!title && needOverlay) {
    // Still add a clean strip so garbled in-image Arabic is less critical
    drawLine(
      (opts.language || "").startsWith("ar")
        ? "رسم تعليمي"
        : "Educational diagram",
      y,
      Math.max(16, Math.round(w * 0.024)),
      true
    );
  }

  return canvas.toBuffer("image/png").toString("base64");
}

/** Safe SVG escape helper for callers that build markup. */
export function xmlEscape(s: string) {
  return escapeXml(s);
}
