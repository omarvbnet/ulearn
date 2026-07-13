import { prisma } from "@/lib/prisma";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { PDFDocument, rgb, type PDFPage, type RGB } from "pdf-lib";
// pptxgenjs CJS export is the constructor itself
import PptxGenJS from "pptxgenjs";
import type { ProfessorArtifactKind } from "@prisma/client";
import {
  drawPdfTextLine,
  embedDocumentFonts,
  hasArabicScript,
  isRtlLanguage,
  measurePdfText,
  pptTextOptions,
  wrapPdfLines,
  type EmbeddedFonts,
} from "../fonts";

export type ExportFigure = {
  pngBase64: string;
  caption?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PptxCtor = (PptxGenJS as any).default ?? PptxGenJS;

/** Print-friendly academic palette (not the dark neon web UI). */
const THEME = {
  ink: rgb(0.06, 0.09, 0.16),
  muted: rgb(0.28, 0.33, 0.41),
  soft: rgb(0.55, 0.6, 0.66),
  paper: rgb(0.98, 0.98, 0.99),
  band: rgb(0.09, 0.31, 0.39),
  bandDeep: rgb(0.06, 0.2, 0.27),
  accent: rgb(0.05, 0.46, 0.56),
  accentSoft: rgb(0.93, 0.98, 0.99),
  line: rgb(0.88, 0.91, 0.93),
  white: rgb(1, 1, 1),
  bullet: rgb(0.05, 0.46, 0.56),
};

const PPT = {
  ink: "0F172A",
  muted: "475569",
  soft: "94A3B8",
  band: "164E63",
  bandDeep: "0F3A47",
  accent: "0E7490",
  accentSoft: "ECFEFF",
  paper: "F8FAFC",
  white: "FFFFFF",
  line: "E2E8F0",
};

function markdownToHtml(title: string, md: string, language: string): string {
  const dir = language === "ar" || language === "ku" ? "rtl" : "ltr";
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const body = escaped
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");
  return `<!DOCTYPE html><html lang="${language}" dir="${dir}"><head><meta charset="utf-8"/><title>${title}</title>
<style>body{font-family:Georgia,serif;max-width:800px;margin:2rem auto;line-height:1.6;padding:0 1rem}h1,h2,h3{color:#0f172a}</style>
</head><body><p>${body}</p></body></html>`;
}

function splitSections(md: string): Array<{ heading: string; body: string }> {
  const parts = md.split(/^##\s+/m).filter(Boolean);
  if (parts.length <= 1) {
    return [{ heading: "Content", body: md }];
  }
  return parts.map((p) => {
    const lines = p.split("\n");
    return {
      heading: lines[0]?.trim() || "Section",
      body: lines.slice(1).join("\n").trim(),
    };
  });
}

function stripMd(s: string): string {
  return s
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^[-*•]\s+/gm, "")
    // Normalize fancy math/punctuation to glyphs both fonts can draw
    .replace(/[≠]/g, "!=")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[×]/g, "x")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .trim();
}

function classifyLine(raw: string): {
  kind: "h1" | "h2" | "h3" | "bullet" | "body";
  text: string;
} {
  const t = raw.trim();
  if (/^#\s+/.test(t)) return { kind: "h1", text: stripMd(t) };
  if (/^##\s+/.test(t)) return { kind: "h2", text: stripMd(t) };
  if (/^###\s+/.test(t)) return { kind: "h3", text: stripMd(t) };
  if (/^[-*•]\s+/.test(t)) return { kind: "bullet", text: stripMd(t) };
  return { kind: "body", text: stripMd(t) };
}

type PdfCtx = {
  pdf: PDFDocument;
  page: PDFPage;
  width: number;
  height: number;
  margin: number;
  y: number;
  fonts: EmbeddedFonts;
  rtl: boolean;
};

function newPage(ctx: PdfCtx, withChrome = true) {
  ctx.page = ctx.pdf.addPage();
  ({ width: ctx.width, height: ctx.height } = ctx.page.getSize());
  // Soft paper background
  ctx.page.drawRectangle({
    x: 0,
    y: 0,
    width: ctx.width,
    height: ctx.height,
    color: THEME.paper,
  });
  if (withChrome) {
    // Top accent bar
    ctx.page.drawRectangle({
      x: 0,
      y: ctx.height - 8,
      width: ctx.width,
      height: 8,
      color: THEME.band,
    });
    // Side rail
    const railX = ctx.rtl ? ctx.width - 10 : 0;
    ctx.page.drawRectangle({
      x: railX,
      y: 0,
      width: 10,
      height: ctx.height,
      color: THEME.accentSoft,
    });
    ctx.page.drawRectangle({
      x: ctx.rtl ? ctx.width - 4 : 0,
      y: 0,
      width: 4,
      height: ctx.height,
      color: THEME.accent,
    });
  }
  ctx.y = ctx.height - ctx.margin - 12;
}

function ensureSpace(ctx: PdfCtx, needed: number) {
  if (ctx.y < ctx.margin + needed) {
    newPage(ctx, true);
  }
}

function drawLine(
  ctx: PdfCtx,
  logical: string,
  size: number,
  color: RGB,
  opts?: { indent?: number; bullet?: boolean }
) {
  const indent = opts?.indent ?? 0;
  const maxW = ctx.width - ctx.margin * 2 - indent - (opts?.bullet ? 16 : 0);
  const visuals = wrapPdfLines(logical, ctx.fonts, size, maxW);
  for (const visual of visuals) {
    if (!visual) continue;
    ensureSpace(ctx, size + 18);
    const tw = measurePdfText(visual, ctx.fonts, size);
    const contentW = ctx.width - ctx.margin * 2 - indent;
    let x: number;
    if (ctx.rtl) {
      x = ctx.width - ctx.margin - indent - tw;
      if (opts?.bullet) {
        const bx = ctx.width - ctx.margin - indent + 6;
        ctx.page.drawCircle({
          x: bx,
          y: ctx.y + size * 0.35,
          size: 2.4,
          color: THEME.bullet,
        });
      }
    } else {
      x = ctx.margin + indent + (opts?.bullet ? 14 : 0);
      if (opts?.bullet) {
        ctx.page.drawCircle({
          x: ctx.margin + indent + 4,
          y: ctx.y + size * 0.35,
          size: 2.4,
          color: THEME.bullet,
        });
      }
    }
    // Safety: if somehow wider, still clamp inside
    if (ctx.rtl) {
      x = Math.min(x, ctx.width - ctx.margin - 4);
      x = Math.max(ctx.margin, x);
    } else {
      x = Math.max(ctx.margin, Math.min(x, ctx.width - ctx.margin - tw));
    }
    void contentW;
    drawPdfTextLine(ctx.page, visual, {
      fonts: ctx.fonts,
      size,
      x,
      y: ctx.y,
      color,
    });
    ctx.y -= size + 7;
  }
  ctx.y -= 2;
}

function drawSectionHeader(ctx: PdfCtx, text: string) {
  ensureSpace(ctx, 42);
  const bandH = 28;
  const bandY = ctx.y - 6;
  ctx.page.drawRectangle({
    x: ctx.margin - 6,
    y: bandY - 6,
    width: ctx.width - ctx.margin * 2 + 12,
    height: bandH,
    color: THEME.accentSoft,
  });
  ctx.page.drawRectangle({
    x: ctx.rtl ? ctx.width - ctx.margin + 2 : ctx.margin - 6,
    y: bandY - 6,
    width: 4,
    height: bandH,
    color: THEME.accent,
  });
  ctx.y = bandY + 4;
  drawLine(ctx, text, 13, THEME.bandDeep);
  ctx.y -= 6;
}

async function drawFigure(ctx: PdfCtx, fig: ExportFigure) {
  try {
    const bytes = Buffer.from(
      fig.pngBase64.replace(/^data:[^;]+;base64,/, ""),
      "base64"
    );
    const img = await ctx.pdf.embedPng(bytes);
    const maxW = ctx.width - ctx.margin * 2;
    const maxH = Math.min(300, ctx.height - ctx.margin * 2);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    ensureSpace(ctx, h + 48);
    // Frame
    const x = ctx.rtl ? ctx.width - ctx.margin - w : ctx.margin;
    ctx.page.drawRectangle({
      x: x - 4,
      y: ctx.y - h - 4,
      width: w + 8,
      height: h + 8,
      color: THEME.white,
      borderColor: THEME.line,
      borderWidth: 1,
    });
    ctx.page.drawImage(img, { x, y: ctx.y - h, width: w, height: h });
    ctx.y -= h + 14;
    if (fig.caption) {
      drawLine(ctx, fig.caption.slice(0, 200), 10, THEME.muted);
    }
    ctx.y -= 10;
  } catch {
    /* skip broken figure */
  }
}

function drawCover(ctx: PdfCtx, title: string, language?: string | null) {
  // Full-bleed cover band
  ctx.page.drawRectangle({
    x: 0,
    y: 0,
    width: ctx.width,
    height: ctx.height,
    color: THEME.bandDeep,
  });
  // Accent diagonal-ish blocks
  ctx.page.drawRectangle({
    x: 0,
    y: ctx.height * 0.62,
    width: ctx.width,
    height: ctx.height * 0.38,
    color: THEME.band,
  });
  ctx.page.drawRectangle({
    x: ctx.rtl ? 0 : ctx.width * 0.72,
    y: 0,
    width: ctx.width * 0.28,
    height: ctx.height,
    color: THEME.accent,
  });

  const brand = "U Learn";
  const brandVisual = brand;
  const brandSize = 14;
  const brandW = measurePdfText(brandVisual, ctx.fonts, brandSize);
  const brandX = ctx.rtl
    ? ctx.width - ctx.margin - brandW
    : ctx.margin;
  drawPdfTextLine(ctx.page, brandVisual, {
    fonts: ctx.fonts,
    size: brandSize,
    x: brandX,
    y: ctx.height - 56,
    color: THEME.white,
  });

  // Title
  const titleSize = 26;
  const titleLines = wrapPdfLines(
    title.slice(0, 160),
    ctx.fonts,
    titleSize,
    ctx.width - ctx.margin * 2
  );
  let ty = ctx.height * 0.48;
  for (const line of titleLines.slice(0, 4)) {
    const tw = measurePdfText(line, ctx.fonts, titleSize);
    const tx = ctx.rtl ? ctx.width - ctx.margin - tw : ctx.margin;
    drawPdfTextLine(ctx.page, line, {
      fonts: ctx.fonts,
      size: titleSize,
      x: tx,
      y: ty,
      color: THEME.white,
    });
    ty -= titleSize + 10;
  }

  const subtitle = isRtlLanguage(language)
    ? "مادة تعليمية · جاهزة للدراسة"
    : "Study material · Ready to learn";
  const subLines = wrapPdfLines(
    subtitle,
    ctx.fonts,
    12,
    ctx.width - ctx.margin * 2
  );
  ty -= 8;
  for (const line of subLines) {
    const tw = measurePdfText(line, ctx.fonts, 12);
    const tx = ctx.rtl ? ctx.width - ctx.margin - tw : ctx.margin;
    drawPdfTextLine(ctx.page, line, {
      fonts: ctx.fonts,
      size: 12,
      x: tx,
      y: ty,
      color: THEME.accentSoft,
    });
    ty -= 16;
  }

  // Bottom label
  const foot = "AI Creative Studio";
  const fw = measurePdfText(foot, ctx.fonts, 10);
  drawPdfTextLine(ctx.page, foot, {
    fonts: ctx.fonts,
    size: 10,
    x: ctx.rtl ? ctx.width - ctx.margin - fw : ctx.margin,
    y: 40,
    color: THEME.soft,
  });
}

export async function buildPdf(
  title: string,
  markdown: string,
  language?: string | null,
  figures?: ExportFigure[]
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const sample = `${title}\n${markdown}`;
  const fonts = await embedDocumentFonts(pdf, sample, language);
  const rtl =
    fonts.rtl ||
    isRtlLanguage(language) ||
    hasArabicScript(sample);

  const ctx: PdfCtx = {
    pdf,
    page: pdf.addPage(),
    width: 0,
    height: 0,
    margin: 54,
    y: 0,
    fonts: { ...fonts, rtl },
    rtl,
  };
  ({ width: ctx.width, height: ctx.height } = ctx.page.getSize());

  // Cover
  drawCover(ctx, title, language);

  // Content pages
  newPage(ctx, true);

  // Document title strip
  drawLine(ctx, title.slice(0, 120), 18, THEME.ink);
  ctx.page.drawRectangle({
    x: ctx.margin,
    y: ctx.y + 4,
    width: Math.min(72, ctx.width - ctx.margin * 2),
    height: 3,
    color: THEME.accent,
  });
  ctx.y -= 16;

  const plainLines = markdown.split(/\n/).filter((l) => l.trim().length > 0);
  for (const raw of plainLines) {
    const { kind, text } = classifyLine(raw);
    if (!text) continue;
    if (kind === "h1") {
      ctx.y -= 6;
      drawLine(ctx, text.slice(0, 200), 16, THEME.ink);
      ctx.y -= 4;
    } else if (kind === "h2") {
      ctx.y -= 4;
      drawSectionHeader(ctx, text.slice(0, 200));
    } else if (kind === "h3") {
      drawLine(ctx, text.slice(0, 200), 12, THEME.band);
    } else if (kind === "bullet") {
      drawLine(ctx, text.slice(0, 2000), 11, THEME.ink, {
        indent: 8,
        bullet: true,
      });
    } else {
      drawLine(ctx, text.slice(0, 2000), 11, THEME.ink);
    }
  }

  for (const fig of figures || []) {
    await drawFigure(ctx, fig);
  }

  // Page numbers (skip cover = page 0)
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    if (i === 0) return;
    const label = `${i} / ${pages.length - 1}`;
    const { width: pw } = p.getSize();
    const lw = measurePdfText(label, fonts, 9);
    drawPdfTextLine(p, label, {
      fonts,
      size: 9,
      x: pw / 2 - lw / 2,
      y: 28,
      color: THEME.soft,
    });
  });

  return pdf.save();
}

export async function buildDocx(
  title: string,
  markdown: string,
  figures?: ExportFigure[],
  language?: string | null
): Promise<Buffer> {
  const rtl =
    isRtlLanguage(language) || hasArabicScript(`${title}\n${markdown}`);
  const children: Paragraph[] = [
    new Paragraph({
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.CENTER,
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 36,
          font: "Arial",
          rightToLeft: rtl,
        }),
      ],
    }),
  ];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("# ")) {
      children.push(
        new Paragraph({
          bidirectional: rtl,
          alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          heading: HeadingLevel.HEADING_1,
          children: [
            new TextRun({
              text: line.replace(/^#\s+/, ""),
              bold: true,
              font: "Arial",
              rightToLeft: rtl,
            }),
          ],
        })
      );
    } else if (line.startsWith("## ")) {
      children.push(
        new Paragraph({
          bidirectional: rtl,
          alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: line.replace(/^##\s+/, ""),
              bold: true,
              font: "Arial",
              rightToLeft: rtl,
            }),
          ],
        })
      );
    } else if (line.startsWith("### ")) {
      children.push(
        new Paragraph({
          bidirectional: rtl,
          alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          heading: HeadingLevel.HEADING_3,
          children: [
            new TextRun({
              text: line.replace(/^###\s+/, ""),
              bold: true,
              font: "Arial",
              rightToLeft: rtl,
            }),
          ],
        })
      );
    } else if (line.trim()) {
      children.push(
        new Paragraph({
          bidirectional: rtl,
          alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [
            new TextRun({
              text: line.replace(/\*\*/g, ""),
              font: "Arial",
              rightToLeft: rtl,
            }),
          ],
        })
      );
    } else {
      children.push(new Paragraph({ text: "" }));
    }
  }

  for (const fig of figures || []) {
    try {
      const bytes = Buffer.from(
        fig.pngBase64.replace(/^data:[^;]+;base64,/, ""),
        "base64"
      );
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: bytes,
              transformation: { width: 480, height: 360 },
              type: "png",
            } as ConstructorParameters<typeof ImageRun>[0]),
          ],
        })
      );
      if (fig.caption) {
        children.push(
          new Paragraph({
            bidirectional: rtl,
            alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [
              new TextRun({
                text: fig.caption,
                italics: true,
                size: 18,
                font: "Arial",
                rightToLeft: rtl,
              }),
            ],
          })
        );
      }
    } catch {
      /* skip */
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

function pptMasterBg(rtl: boolean) {
  return [
    {
      type: "rect" as const,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      fill: { color: PPT.paper },
    },
    {
      type: "rect" as const,
      x: 0,
      y: 0,
      w: "100%",
      h: 0.12,
      fill: { color: PPT.band },
    },
    {
      type: "rect" as const,
      x: rtl ? 9.87 : 0,
      y: 0,
      w: 0.13,
      h: "100%",
      fill: { color: PPT.accent },
    },
  ];
}

export async function buildPptx(
  title: string,
  markdown: string,
  language?: string | null,
  figures?: ExportFigure[]
): Promise<Buffer> {
  const pptx = new PptxCtor();
  pptx.author = "U Learn AI";
  pptx.title = title;
  pptx.defineLayout({ name: "ULEARN_16x9", width: 10, height: 5.625 });
  pptx.layout = "ULEARN_16x9";
  const rtl =
    isRtlLanguage(language) || hasArabicScript(`${title}\n${markdown}`);
  const pptLang = rtl ? language || "ar" : language;
  if (rtl) {
    pptx.rtlMode = true;
    pptx.theme = { lang: "ar", headFontFace: "Arial", bodyFontFace: "Arial" };
  }

  // —— Cover ——
  const cover = pptx.addSlide();
  cover.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: "100%",
    h: "100%",
    fill: { color: PPT.bandDeep },
  });
  cover.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 3.6,
    w: "100%",
    h: 2.025,
    fill: { color: PPT.band },
  });
  cover.addShape(pptx.ShapeType.rect, {
    x: rtl ? 0 : 8.2,
    y: 0,
    w: 1.8,
    h: "100%",
    fill: { color: PPT.accent },
    shadow: { type: "outer", color: "000000", blur: 12, opacity: 0.15 },
  });
  cover.addText("U Learn", {
    x: 0.6,
    y: 0.45,
    w: 8.8,
    h: 0.4,
    fontSize: 14,
    bold: true,
    color: PPT.accentSoft,
    ...pptTextOptions(pptLang),
  });
  cover.addText(title, {
    x: 0.6,
    y: 2.0,
    w: 8.5,
    h: 1.4,
    fontSize: 32,
    bold: true,
    color: PPT.white,
    ...pptTextOptions(pptLang),
  });
  cover.addText(
    rtl ? "مادة تعليمية جاهزة للدراسة" : "Study material · Ready to learn",
    {
      x: 0.6,
      y: 4.1,
      w: 8.5,
      h: 0.4,
      fontSize: 14,
      color: PPT.accentSoft,
      ...pptTextOptions(pptLang),
    }
  );
  cover.addText("AI Creative Studio", {
    x: 0.6,
    y: 5.1,
    w: 8.5,
    h: 0.3,
    fontSize: 11,
    color: PPT.soft,
    ...pptTextOptions(pptLang),
  });

  const sections = splitSections(markdown).slice(0, 20);
  const figs = figures || [];

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]!;
    const slide = pptx.addSlide();
    for (const shape of pptMasterBg(rtl)) {
      slide.addShape(pptx.ShapeType.rect, shape);
    }

    const hasFig = Boolean(figs[si]);

    // Section index pill
    slide.addShape(pptx.ShapeType.roundRect, {
      x: rtl ? 8.55 : 0.5,
      y: 0.28,
      w: 0.95,
      h: 0.32,
      fill: { color: PPT.accentSoft },
      rectRadius: 0.08,
    });
    slide.addText(`${si + 1}`, {
      x: rtl ? 8.55 : 0.5,
      y: 0.28,
      w: 0.95,
      h: 0.32,
      fontSize: 11,
      bold: true,
      color: PPT.accent,
      align: "center",
      valign: "middle",
    });

    slide.addText(section.heading.slice(0, 80), {
      x: 0.5,
      y: 0.7,
      w: 9,
      h: 0.55,
      fontSize: 24,
      bold: true,
      color: PPT.ink,
      ...pptTextOptions(pptLang),
    });

    // Accent underline
    slide.addShape(pptx.ShapeType.rect, {
      x: rtl ? 8.7 : 0.5,
      y: 1.28,
      w: 0.8,
      h: 0.06,
      fill: { color: PPT.accent },
    });

    const bullets = section.body
      .split(/\n/)
      .map((l: string) => l.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean)
      .slice(0, hasFig ? 5 : 8);

    slide.addText(
      bullets.map((b: string) => ({
        text: b.slice(0, 180),
        options: {
          bullet: true,
          breakLine: true,
          ...pptTextOptions(pptLang),
        },
      })),
      {
        x: 0.5,
        y: 1.5,
        w: hasFig ? (rtl ? 4.8 : 4.6) : 9,
        h: hasFig ? 3.6 : 3.8,
        fontSize: 15,
        color: PPT.muted,
        paraSpaceAfter: 8,
        ...pptTextOptions(pptLang),
      }
    );

    if (hasFig) {
      try {
        const imgX = rtl ? 0.45 : 5.3;
        slide.addShape(pptx.ShapeType.roundRect, {
          x: imgX - 0.08,
          y: 1.42,
          w: 4.36,
          h: 3.7,
          fill: { color: PPT.white },
          shadow: {
            type: "outer",
            color: "0F172A",
            blur: 10,
            opacity: 0.08,
            offset: 2,
          },
          rectRadius: 0.1,
        });
        slide.addImage({
          data: figs[si]!.pngBase64.replace(/^data:[^;]+;base64,/, ""),
          x: imgX,
          y: 1.5,
          w: 4.2,
          h: 3.55,
        });
      } catch {
        /* skip */
      }
    }

    // Footer
    slide.addText("U Learn", {
      x: 0.5,
      y: 5.25,
      w: 4,
      h: 0.25,
      fontSize: 10,
      color: PPT.soft,
      ...pptTextOptions(pptLang),
    });
    slide.addText(`${si + 1} / ${sections.length}`, {
      x: 8.2,
      y: 5.25,
      w: 1.3,
      h: 0.25,
      fontSize: 10,
      color: PPT.soft,
      align: "right",
    });
  }

  for (let i = sections.length; i < figs.length; i++) {
    const slide = pptx.addSlide();
    for (const shape of pptMasterBg(rtl)) {
      slide.addShape(pptx.ShapeType.rect, shape);
    }
    slide.addText(figs[i]!.caption || `Figure ${i + 1}`, {
      x: 0.5,
      y: 0.35,
      w: 9,
      h: 0.5,
      fontSize: 20,
      bold: true,
      color: PPT.ink,
      ...pptTextOptions(pptLang),
    });
    try {
      slide.addImage({
        data: figs[i]!.pngBase64.replace(/^data:[^;]+;base64,/, ""),
        x: 1.1,
        y: 1.0,
        w: 7.8,
        h: 4.0,
      });
    } catch {
      /* skip */
    }
  }

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return out;
}

export class ProfessorExportService {
  static async exportAll(input: {
    instructorId: string;
    generationId: string;
    title: string;
    markdown: string;
    language: string;
    formats: Array<"markdown" | "html" | "pdf" | "docx" | "pptx">;
  }) {
    const artifacts = [];
    const safe = input.title.replace(/[^\w\-]+/g, "_").slice(0, 40) || "content";

    for (const fmt of input.formats) {
      if (fmt === "markdown") {
        artifacts.push(
          await prisma.professorArtifact.create({
            data: {
              instructorId: input.instructorId,
              generationId: input.generationId,
              kind: "MARKDOWN",
              fileName: `${safe}.md`,
              contentText: input.markdown,
            },
          })
        );
      } else if (fmt === "html") {
        artifacts.push(
          await prisma.professorArtifact.create({
            data: {
              instructorId: input.instructorId,
              generationId: input.generationId,
              kind: "HTML",
              fileName: `${safe}.html`,
              contentText: markdownToHtml(
                input.title,
                input.markdown,
                input.language
              ),
            },
          })
        );
      } else if (fmt === "pdf") {
        const bytes = await buildPdf(
          input.title,
          input.markdown,
          input.language
        );
        artifacts.push(
          await prisma.professorArtifact.create({
            data: {
              instructorId: input.instructorId,
              generationId: input.generationId,
              kind: "PDF",
              fileName: `${safe}.pdf`,
              contentText: Buffer.from(bytes).toString("base64"),
              meta: { encoding: "base64" },
            },
          })
        );
      } else if (fmt === "docx") {
        const buf = await buildDocx(
          input.title,
          input.markdown,
          undefined,
          input.language
        );
        artifacts.push(
          await prisma.professorArtifact.create({
            data: {
              instructorId: input.instructorId,
              generationId: input.generationId,
              kind: "DOCX",
              fileName: `${safe}.docx`,
              contentText: buf.toString("base64"),
              meta: { encoding: "base64" },
            },
          })
        );
      } else if (fmt === "pptx") {
        const buf = await buildPptx(
          input.title,
          input.markdown,
          input.language
        );
        artifacts.push(
          await prisma.professorArtifact.create({
            data: {
              instructorId: input.instructorId,
              generationId: input.generationId,
              kind: "PPTX",
              fileName: `${safe}.pptx`,
              contentText: buf.toString("base64"),
              meta: { encoding: "base64" },
            },
          })
        );
      }
    }

    return artifacts;
  }

  static async getArtifact(instructorId: string, id: string) {
    return prisma.professorArtifact.findFirst({
      where: { id, instructorId },
    });
  }

  static kindMime(kind: ProfessorArtifactKind): string {
    switch (kind) {
      case "PDF":
        return "application/pdf";
      case "DOCX":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      case "PPTX":
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      case "HTML":
        return "text/html; charset=utf-8";
      case "MARKDOWN":
        return "text/markdown; charset=utf-8";
      case "JSON":
      case "FLASHCARDS":
      case "MIND_MAP":
        return "application/json";
      default:
        return "application/octet-stream";
    }
  }
}
