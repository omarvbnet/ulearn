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
import { PDFDocument, rgb } from "pdf-lib";
// pptxgenjs CJS export is the constructor itself
import PptxGenJS from "pptxgenjs";
import type { ProfessorArtifactKind } from "@prisma/client";
import {
  embedDocumentFonts,
  hasArabicScript,
  isRtlLanguage,
  preparePdfText,
  pptTextOptions,
  wrapPdfLines,
} from "../fonts";

export type ExportFigure = {
  pngBase64: string;
  caption?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PptxCtor = (PptxGenJS as any).default ?? PptxGenJS;

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
    return { heading: lines[0]?.trim() || "Section", body: lines.slice(1).join("\n").trim() };
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
  const { regular: font, bold, rtl } = await embedDocumentFonts(
    pdf,
    sample,
    language
  );
  let page = pdf.addPage();
  let { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const ensureSpace = (needed: number) => {
    if (y < margin + needed) {
      page = pdf.addPage();
      ({ width, height } = page.getSize());
      y = height - margin;
    }
  };

  const draw = (raw: string, size: number, isBold = false) => {
    const f = isBold ? bold : font;
    const maxW = width - margin * 2;
    // Wrap on logical text, then shape each line (never wrap the visual string).
    const lines = wrapPdfLines(raw, f, size, maxW);
    for (const visual of lines) {
      if (!visual) continue;
      ensureSpace(size + 20);
      const tw = f.widthOfTextAtSize(visual, size);
      const x = rtl ? Math.max(margin, width - margin - tw) : margin;
      page.drawText(visual, {
        x,
        y,
        size,
        font: f,
        color: rgb(0.1, 0.1, 0.15),
      });
      y -= size + 6;
    }
    y -= 4;
  };

  const drawFigure = async (fig: ExportFigure) => {
    try {
      const bytes = Buffer.from(fig.pngBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
      const img = await pdf.embedPng(bytes);
      const maxW = width - margin * 2;
      const maxH = Math.min(320, height - margin * 2);
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      ensureSpace(h + 36);
      const x = rtl ? width - margin - w : margin;
      page.drawImage(img, { x, y: y - h, width: w, height: h });
      y -= h + 8;
      if (fig.caption) draw(fig.caption.slice(0, 200), 10);
      y -= 10;
    } catch {
      /* skip broken figure */
    }
  };

  draw(title.slice(0, 120), 18, true);
  y -= 8;
  const plain = markdown
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "");
  for (const para of plain.split(/\n+/).filter(Boolean)) {
    draw(para.slice(0, 2000), 11);
  }

  for (const fig of figures || []) {
    await drawFigure(fig);
  }

  // page numbers (Western digits — always Latin-safe)
  const pages = pdf.getPages();
  const pageFont = font;
  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`;
    const { width: pw } = p.getSize();
    p.drawText(label, {
      x: pw / 2 - 20,
      y: 24,
      size: 9,
      font: pageFont,
      color: rgb(0.4, 0.4, 0.45),
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
  const rtl = isRtlLanguage(language) || hasArabicScript(`${title}\n${markdown}`);
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

export async function buildPptx(
  title: string,
  markdown: string,
  language?: string | null,
  figures?: ExportFigure[]
): Promise<Buffer> {
  const pptx = new PptxCtor();
  pptx.author = "U Learn AI";
  pptx.title = title;
  const rtl =
    isRtlLanguage(language) || hasArabicScript(`${title}\n${markdown}`);
  // Effective lang for ppt options — force ar when content is Arabic even if UI locale is en
  const pptLang = rtl ? language || "ar" : language;
  if (rtl) {
    pptx.rtlMode = true;
    pptx.theme = { lang: "ar", headFontFace: "Arial", bodyFontFace: "Arial" };
  }

  const cover = pptx.addSlide();
  cover.addText(title, {
    x: 0.5,
    y: 2.2,
    w: 9,
    h: 1.5,
    fontSize: 28,
    bold: true,
    color: "0F172A",
    ...pptTextOptions(pptLang),
  });
  cover.addText("U Learn AI", {
    x: 0.5,
    y: 4,
    w: 9,
    h: 0.4,
    fontSize: 14,
    color: "64748B",
    ...pptTextOptions(pptLang),
  });

  const sections = splitSections(markdown).slice(0, 20);
  const figs = figures || [];
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]!;
    const slide = pptx.addSlide();
    const hasFig = Boolean(figs[si]);
    slide.addText(section.heading.slice(0, 80), {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.5,
      fontSize: 22,
      bold: true,
      color: "0F172A",
      ...pptTextOptions(pptLang),
    });
    const bullets = section.body
      .split(/\n/)
      .map((l: string) => l.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean)
      .slice(0, hasFig ? 5 : 8);
    slide.addText(
      bullets.map((b: string) => ({
        text: b.slice(0, 180),
        options: { bullet: true, ...pptTextOptions(pptLang) },
      })),
      {
        x: 0.5,
        y: 0.95,
        w: hasFig ? 4.6 : 9,
        h: hasFig ? 4.2 : 4.5,
        fontSize: 14,
        color: "334155",
        ...pptTextOptions(pptLang),
      }
    );
    if (hasFig) {
      try {
        slide.addImage({
          data: figs[si]!.pngBase64.replace(/^data:[^;]+;base64,/, ""),
          x: 5.3,
          y: 1.0,
          w: 4.2,
          h: 4.0,
        });
      } catch {
        /* skip */
      }
    }
  }

  // Extra figure slides for remaining images
  for (let i = sections.length; i < figs.length; i++) {
    const slide = pptx.addSlide();
    slide.addText(figs[i]!.caption || `Figure ${i + 1}`, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.5,
      fontSize: 18,
      bold: true,
      ...pptTextOptions(pptLang),
    });
    try {
      slide.addImage({
        data: figs[i]!.pngBase64.replace(/^data:[^;]+;base64,/, ""),
        x: 1.2,
        y: 1.0,
        w: 7.5,
        h: 4.5,
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
              contentText: markdownToHtml(input.title, input.markdown, input.language),
            },
          })
        );
      } else if (fmt === "pdf") {
        const bytes = await buildPdf(input.title, input.markdown, input.language);
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
        const buf = await buildPptx(input.title, input.markdown, input.language);
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
