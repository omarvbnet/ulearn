import { OcrService } from "./ocr.service";

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType?: string | null,
  fileName?: string | null
): Promise<{ text: string; pageCount?: number }> {
  const lower = (fileName || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (mime.includes("text/") || lower.endsWith(".txt") || lower.endsWith(".md")) {
    return { text: buffer.toString("utf8") };
  }

  if (
    mime.includes("wordprocessingml") ||
    mime.includes("msword") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".doc")
  ) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value || "" };
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "DOCX extract failed");
    }
  }

  if (mime.includes("pdf") || lower.endsWith(".pdf")) {
    try {
      // unpdf is Node/serverless-safe (pdf-parse v2 needs DOMMatrix / browser APIs).
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffer), { mergePages: true });
      let text = Array.isArray(result.text) ? result.text.join("\n") : String(result.text || "");
      const pageCount = typeof result.totalPages === "number" ? result.totalPages : undefined;
      if (text.trim().length < 40) {
        const ocr = await OcrService.extractFromScannedPdf(buffer);
        text = ocr || text;
      }
      return { text, pageCount };
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "PDF extract failed");
    }
  }

  throw new Error(`Unsupported format for v1 ingest: ${mimeType || fileName || "unknown"}`);
}
