import { prisma } from "@/lib/prisma";
import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "@/lib/r2-client";
import { isR2Configured } from "@/lib/r2";
import { readFile } from "fs/promises";
import path from "path";
import { ProfessorJobService } from "./job.service";
import { extractTextFromBuffer } from "../text-extract";
import { LoggingService } from "@/services/logging.service";
import type { Prisma } from "@prisma/client";

export type PdfTool =
  | "MERGE"
  | "SPLIT"
  | "ROTATE"
  | "WATERMARK"
  | "PROTECT"
  | "COMPRESS"
  | "EXTRACT_TEXT"
  | "COMPARE"
  | "CONVERT_DOCX"
  | "CONVERT_PPTX";

async function loadBytes(fileKey?: string | null, fileUrl?: string | null): Promise<Uint8Array> {
  if (fileKey && isR2Configured()) {
    const res = await r2Client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: fileKey })
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error("Empty R2 object");
    return bytes;
  }
  if (fileKey) {
    const local = path.join(process.cwd(), "public", "uploads", fileKey);
    return new Uint8Array(await readFile(local));
  }
  if (fileUrl?.startsWith("http")) {
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error("Failed to fetch file");
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error("No file source");
}

async function loadDocPdf(instructorId: string, documentId: string) {
  const doc = await prisma.kbDocument.findFirst({
    where: {
      id: documentId,
      instructorId,
      deletedAt: null,
    },
  });
  if (!doc) throw new Error("Document not found");
  const bytes = await loadBytes(doc.fileKey, doc.fileUrl);
  return { doc, bytes };
}

export class ProfessorPdfToolsService {
  static async run(input: {
    instructorId: string;
    tool: PdfTool;
    documentIds: string[];
    options?: {
      pages?: number[];
      rotateDegrees?: number;
      watermarkText?: string;
      password?: string;
      compareWithDocumentId?: string;
    };
  }) {
    const job = await ProfessorJobService.create({
      instructorId: input.instructorId,
      type: "PDF_TOOL",
      documentId: input.documentIds[0],
      inputJson: { tool: input.tool, options: input.options } as Prisma.InputJsonValue,
    });

    ProfessorJobService.enqueue(job.id, async (report) => {
      await report(10);
      let outBytes: Uint8Array | null = null;
      let contentText: string | null = null;
      let kind: "PDF" | "JSON" | "MARKDOWN" | "DOCX" | "PPTX" = "PDF";
      let fileName = `tool_${input.tool.toLowerCase()}.pdf`;

      if (input.tool === "MERGE") {
        const merged = await PDFDocument.create();
        for (const id of input.documentIds) {
          const { bytes } = await loadDocPdf(input.instructorId, id);
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const pages = await merged.copyPages(src, src.getPageIndices());
          pages.forEach((p) => merged.addPage(p));
        }
        outBytes = await merged.save();
        fileName = "merged.pdf";
      } else if (input.tool === "SPLIT") {
        const { bytes } = await loadDocPdf(input.instructorId, input.documentIds[0]);
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = input.options?.pages?.length
          ? input.options.pages.map((p) => p - 1).filter((i) => i >= 0 && i < src.getPageCount())
          : [0];
        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, pages);
        copied.forEach((p) => out.addPage(p));
        outBytes = await out.save();
        fileName = "split.pdf";
      } else if (input.tool === "ROTATE") {
        const { bytes } = await loadDocPdf(input.instructorId, input.documentIds[0]);
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const deg = input.options?.rotateDegrees || 90;
        pdf.getPages().forEach((p) => p.setRotation(degrees(deg)));
        outBytes = await pdf.save();
        fileName = "rotated.pdf";
      } else if (input.tool === "WATERMARK") {
        const { bytes } = await loadDocPdf(input.instructorId, input.documentIds[0]);
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const font = await pdf.embedFont(StandardFonts.HelveticaBold);
        const text = input.options?.watermarkText || "u learn";
        for (const page of pdf.getPages()) {
          const { width, height } = page.getSize();
          page.drawText(text, {
            x: width / 4,
            y: height / 2,
            size: 48,
            font,
            color: rgb(0.7, 0.7, 0.75),
            opacity: 0.25,
            rotate: degrees(-30),
          });
        }
        outBytes = await pdf.save();
        fileName = "watermarked.pdf";
      } else if (input.tool === "PROTECT") {
        // pdf-lib cannot fully encrypt; store a note + copy with metadata marker.
        const { bytes } = await loadDocPdf(input.instructorId, input.documentIds[0]);
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        pdf.setTitle(`Protected:${input.options?.password ? "yes" : "no"}`);
        pdf.setProducer("AI Professor Studio");
        outBytes = await pdf.save();
        fileName = "protected_copy.pdf";
        contentText = JSON.stringify({
          note: "Full password encryption requires qpdf in the deploy image. Metadata-marked copy returned.",
          passwordSet: Boolean(input.options?.password),
        });
      } else if (input.tool === "COMPRESS") {
        const { bytes } = await loadDocPdf(input.instructorId, input.documentIds[0]);
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        // Re-save without object streams extras — modest shrink.
        outBytes = await pdf.save({ useObjectStreams: true });
        fileName = "compressed.pdf";
      } else if (input.tool === "EXTRACT_TEXT") {
        const { bytes, doc } = await loadDocPdf(input.instructorId, input.documentIds[0]);
        const text = await extractTextFromBuffer(
          Buffer.from(bytes),
          doc.mimeType || "application/pdf",
          doc.fileName
        );
        contentText = text.text || "";
        kind = "MARKDOWN";
        fileName = "extracted.txt";
      } else if (input.tool === "COMPARE") {
        const a = await loadDocPdf(input.instructorId, input.documentIds[0]);
        const bId = input.options?.compareWithDocumentId || input.documentIds[1];
        if (!bId) throw new Error("compareWithDocumentId required");
        const b = await loadDocPdf(input.instructorId, bId);
        const textA = (
          await extractTextFromBuffer(
            Buffer.from(a.bytes),
            a.doc.mimeType || "application/pdf",
            a.doc.fileName
          )
        ).text;
        const textB = (
          await extractTextFromBuffer(
            Buffer.from(b.bytes),
            b.doc.mimeType || "application/pdf",
            b.doc.fileName
          )
        ).text;
        const linesA = new Set((textA || "").split(/\n/).map((l) => l.trim()).filter(Boolean));
        const linesB = (textB || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
        const onlyB = linesB.filter((l) => !linesA.has(l)).slice(0, 200);
        const onlyA = [...linesA].filter((l) => !new Set(linesB).has(l)).slice(0, 200);
        contentText = JSON.stringify({ onlyInFirst: onlyA, onlyInSecond: onlyB }, null, 2);
        kind = "JSON";
        fileName = "compare.json";
      } else if (input.tool === "CONVERT_DOCX" || input.tool === "CONVERT_PPTX") {
        // Without LibreOffice, export extracted text as markdown placeholder artifact.
        const { bytes, doc } = await loadDocPdf(input.instructorId, input.documentIds[0]);
        const text = await extractTextFromBuffer(
          Buffer.from(bytes),
          doc.mimeType || "application/pdf",
          doc.fileName
        );
        contentText =
          `# Converted from ${doc.fileName}\n\n` +
          `> Full PDF↔Office conversion requires LibreOffice in the deploy image.\n\n` +
          (text.text || "");
        kind = "MARKDOWN";
        fileName =
          input.tool === "CONVERT_DOCX" ? "converted_preview.md" : "converted_pptx_preview.md";
      } else {
        throw new Error("Unsupported tool");
      }

      await report(85);

      const artifact = await prisma.professorArtifact.create({
        data: {
          instructorId: input.instructorId,
          jobId: job.id,
          documentId: input.documentIds[0],
          kind,
          fileName,
          contentText:
            outBytes != null
              ? Buffer.from(outBytes).toString("base64")
              : contentText || undefined,
          meta: {
            tool: input.tool,
            encoding: outBytes != null ? "base64" : "utf8",
          },
        },
      });

      void LoggingService.log({
        actorId: input.instructorId,
        action: "PROFESSOR_PDF_TOOL",
        entityType: "ProfessorArtifact",
        entityId: artifact.id,
        newValue: { tool: input.tool },
      });

      return { artifactId: artifact.id, tool: input.tool, fileName };
    });

    return { jobId: job.id };
  }
}
