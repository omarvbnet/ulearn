import { PDFDocument, rgb, degrees, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import {
  drawPdfTextLine,
  embedDocumentFonts,
  measurePdfText,
  preparePdfText,
  wrapPdfLines,
  type EmbeddedFonts,
} from "@/services/ai/fonts";

export type CourseCertificatePdfInput = {
  userName: string;
  courseTitle: string;
  courseDescription?: string | null;
  teacherName: string;
  totalHours: number;
  completionDate: Date;
  certificateNumber: string;
  verificationUrl: string;
  locale?: string | null;
};

const NAVY = rgb(0.05, 0.12, 0.2);
const INK = rgb(0.1, 0.14, 0.18);
const MUTED = rgb(0.35, 0.4, 0.45);
const GOLD = rgb(0.72, 0.58, 0.28);
const CREAM = rgb(0.98, 0.96, 0.92);
const PAPER = rgb(0.99, 0.98, 0.96);

function hoursLabel(hours: number): string {
  if (hours <= 0) return "—";
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins} min`;
  }
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} ${rounded === 1 ? "hour" : "hours"}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function drawCentered(
  page: PDFPage,
  fonts: EmbeddedFonts,
  text: string,
  size: number,
  y: number,
  color = INK,
  pageWidth = 842
) {
  const visual = preparePdfText(text);
  const w = measurePdfText(visual, fonts, size);
  drawPdfTextLine(page, visual, {
    fonts,
    size,
    x: (pageWidth - w) / 2,
    y,
    color,
  });
}

/** Elegant landscape professional completion certificate. */
export async function buildCourseCertificatePdf(
  input: CourseCertificatePdfInput
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const width = 842;
  const height = 595;
  const page = pdf.addPage([width, height]);

  const sample = [
    input.userName,
    input.courseTitle,
    input.courseDescription ?? "",
    input.teacherName,
  ].join(" ");
  const fonts = await embedDocumentFonts(pdf, sample, input.locale);

  page.drawRectangle({ x: 0, y: 0, width, height, color: PAPER });

  page.drawRectangle({
    x: 18,
    y: 18,
    width: width - 36,
    height: height - 36,
    borderColor: NAVY,
    borderWidth: 2.5,
  });
  page.drawRectangle({
    x: 28,
    y: 28,
    width: width - 56,
    height: height - 56,
    borderColor: GOLD,
    borderWidth: 1.25,
  });
  page.drawRectangle({
    x: 38,
    y: 38,
    width: width - 76,
    height: height - 76,
    color: CREAM,
  });

  const ornament = (x: number, y: number, rot = 0) => {
    page.drawRectangle({
      x,
      y,
      width: 22,
      height: 2,
      color: GOLD,
      rotate: degrees(rot),
    });
    page.drawRectangle({
      x,
      y,
      width: 2,
      height: 22,
      color: GOLD,
      rotate: degrees(rot),
    });
  };
  ornament(48, height - 70);
  ornament(width - 70, height - 70, 90);
  ornament(48, 48, -90);
  ornament(width - 70, 48, 180);

  const brand = preparePdfText("U Learn");
  const brandW = measurePdfText(brand, fonts, 18);
  const markX = width / 2 - brandW / 2 - 28;
  const markY = height - 112;
  page.drawCircle({
    x: markX + 14,
    y: markY + 8,
    size: 14,
    borderColor: NAVY,
    borderWidth: 2,
  });
  page.drawCircle({
    x: markX + 14,
    y: markY + 8,
    size: 6,
    color: GOLD,
  });
  drawPdfTextLine(page, brand, {
    fonts,
    size: 18,
    x: markX + 36,
    y: markY + 2,
    color: NAVY,
  });

  drawCentered(page, fonts, "CERTIFICATE OF COMPLETION", 11, height - 148, GOLD);
  page.drawRectangle({
    x: width / 2 - 48,
    y: height - 158,
    width: 96,
    height: 1.5,
    color: GOLD,
  });

  drawCentered(page, fonts, "This certifies that", 12, height - 188, MUTED);

  const nameSize = input.userName.length > 28 ? 26 : 32;
  drawCentered(page, fonts, input.userName, nameSize, height - 228, NAVY);
  const nameW = measurePdfText(preparePdfText(input.userName), fonts, nameSize);
  page.drawRectangle({
    x: width / 2 - Math.min(200, nameW / 2 + 12),
    y: height - 238,
    width: Math.min(400, nameW + 24),
    height: 1,
    color: GOLD,
  });

  drawCentered(
    page,
    fonts,
    "has successfully completed the professional course",
    11,
    height - 262,
    MUTED
  );

  const titleSize = input.courseTitle.length > 48 ? 16 : 20;
  drawCentered(page, fonts, input.courseTitle, titleSize, height - 292, INK);

  if (input.courseDescription?.trim()) {
    const desc = input.courseDescription.trim().replace(/\s+/g, " ");
    // wrapPdfLines already returns visual (shaped) lines for Arabic.
    const lines = wrapPdfLines(desc, fonts, 10, width - 220).slice(0, 2);
    let dy = height - 318;
    for (const line of lines) {
      const w = measurePdfText(line, fonts, 10);
      drawPdfTextLine(page, line, {
        fonts,
        size: 10,
        x: (width - w) / 2,
        y: dy,
        color: MUTED,
      });
      dy -= 14;
    }
  }

  const metaY = 118;
  const colW = (width - 160) / 3;
  const cols = [
    { label: "Instructor", value: input.teacherName },
    { label: "Total time", value: hoursLabel(input.totalHours) },
    { label: "Completed", value: formatDate(input.completionDate) },
  ];
  cols.forEach((col, i) => {
    const cx = 80 + i * colW + colW / 2;
    const labelVisual = preparePdfText(col.label.toUpperCase());
    const valueVisual = preparePdfText(col.value);
    const lw = measurePdfText(labelVisual, fonts, 8);
    const vw = measurePdfText(valueVisual, fonts, 11);
    drawPdfTextLine(page, labelVisual, {
      fonts,
      size: 8,
      x: cx - lw / 2,
      y: metaY + 22,
      color: GOLD,
    });
    drawPdfTextLine(page, valueVisual, {
      fonts,
      size: 11,
      x: cx - vw / 2,
      y: metaY,
      color: NAVY,
    });
  });

  drawCentered(
    page,
    fonts,
    `Certificate No. ${input.certificateNumber}`,
    8,
    72,
    MUTED
  );

  try {
    const qrPng = await QRCode.toBuffer(input.verificationUrl, {
      type: "png",
      margin: 1,
      width: 96,
      color: { dark: "#0B1F33", light: "#FBF9F5" },
    });
    const qrImage = await pdf.embedPng(qrPng);
    page.drawImage(qrImage, {
      x: width - 128,
      y: 48,
      width: 72,
      height: 72,
    });
    const verifyHint = preparePdfText("Verify");
    const hw = measurePdfText(verifyHint, fonts, 7);
    drawPdfTextLine(page, verifyHint, {
      fonts,
      size: 7,
      x: width - 128 + (72 - hw) / 2,
      y: 42,
      color: MUTED,
    });
  } catch {
    /* QR optional */
  }

  page.drawCircle({
    x: 96,
    y: 86,
    size: 28,
    borderColor: GOLD,
    borderWidth: 2,
  });
  page.drawCircle({
    x: 96,
    y: 86,
    size: 22,
    borderColor: NAVY,
    borderWidth: 1,
  });
  const seal = preparePdfText("U Learn");
  const sw = measurePdfText(seal, fonts, 7);
  drawPdfTextLine(page, seal, {
    fonts,
    size: 7,
    x: 96 - sw / 2,
    y: 83,
    color: NAVY,
  });

  pdf.setTitle(`U Learn Certificate — ${input.courseTitle}`);
  pdf.setAuthor("U Learn");
  pdf.setSubject(`Certificate of completion for ${input.userName}`);

  return pdf.save();
}
