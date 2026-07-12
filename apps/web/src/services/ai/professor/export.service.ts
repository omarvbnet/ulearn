import { prisma } from "@/lib/prisma";
import {
  AlignmentType,
  Document,
  HeadingLevel,
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
  preparePdfText,
  pptTextOptions,
} from "../fonts";

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
  language?: string | null
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

  const draw = (raw: string, size: number, isBold = false) => {
    const f = isBold ? bold : font;
    const text = preparePdfText(raw);
    // Arabic: split by spaces still works after reshape for wrapping approx.
    const words = text.split(/\s+/);
    let line = "";
    const maxW = width - margin * 2;
    const flush = (toDraw: string) => {
      if (!toDraw) return;
      if (y < margin + 20) {
        page = pdf.addPage();
        ({ width, height } = page.getSize());
        y = height - margin;
      }
      const tw = f.widthOfTextAtSize(toDraw, size);
      const x = rtl ? Math.max(margin, width - margin - tw) : margin;
      page.drawText(toDraw, { x, y, size, font: f, color: rgb(0.1, 0.1, 0.15) });
      y -= size + 6;
    };
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > maxW) {
        flush(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) {
      flush(line);
      y -= 4;
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

  // page numbers (Western digits — always Latin-safe)
  const pages = pdf.getPages();
  const pageFont = font;
  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`;
    p.drawText(label, {
      x: width / 2 - 20,
      y: 24,
      size: 9,
      font: pageFont,
      color: rgb(0.4, 0.4, 0.45),
    });
  });

  return pdf.save();
}

async function buildDocx(title: string, markdown: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
  ];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("# ")) {
      children.push(
        new Paragraph({ text: line.replace(/^#\s+/, ""), heading: HeadingLevel.HEADING_1 })
      );
    } else if (line.startsWith("## ")) {
      children.push(
        new Paragraph({ text: line.replace(/^##\s+/, ""), heading: HeadingLevel.HEADING_2 })
      );
    } else if (line.startsWith("### ")) {
      children.push(
        new Paragraph({ text: line.replace(/^###\s+/, ""), heading: HeadingLevel.HEADING_3 })
      );
    } else if (line.trim()) {
      children.push(
        new Paragraph({
          children: [new TextRun(line.replace(/\*\*/g, ""))],
        })
      );
    } else {
      children.push(new Paragraph({ text: "" }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export async function buildPptx(
  title: string,
  markdown: string,
  language?: string | null
): Promise<Buffer> {
  const pptx = new PptxCtor();
  pptx.author = "U Learn AI";
  pptx.title = title;
  const rtl = (language || "").toLowerCase().startsWith("ar") ||
    (language || "").toLowerCase().startsWith("ku");
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
    ...pptTextOptions(language),
  });
  cover.addText("U Learn AI", {
    x: 0.5,
    y: 4,
    w: 9,
    h: 0.4,
    fontSize: 14,
    color: "64748B",
    ...pptTextOptions(language),
  });

  for (const section of splitSections(markdown).slice(0, 20)) {
    const slide = pptx.addSlide();
    slide.addText(section.heading.slice(0, 80), {
      x: 0.5,
      y: 0.4,
      w: 9,
      h: 0.6,
      fontSize: 22,
      bold: true,
      color: "0F172A",
      ...pptTextOptions(language),
    });
    const bullets = section.body
      .split(/\n/)
      .map((l: string) => l.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean)
      .slice(0, 8);
    slide.addText(
      bullets.map((b: string) => ({
        text: b.slice(0, 180),
        options: { bullet: true, ...pptTextOptions(language) },
      })),
      {
        x: 0.5,
        y: 1.2,
        w: 9,
        h: 4,
        fontSize: 14,
        color: "334155",
        ...pptTextOptions(language),
      }
    );
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
        const buf = await buildDocx(input.title, input.markdown);
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
