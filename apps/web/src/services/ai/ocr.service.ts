import { AiProviderService } from "./ai-provider.service";
import type { ChatMessage } from "./types";

/**
 * Transcribe / OCR attachments via a vision-capable provider (OCR_ANALYSIS → Gemini).
 * Text is then injected into chat so DeepSeek/Kimi (no vision) can still answer.
 */
export class OcrService {
  static async extractFromImage(
    buffer: Buffer,
    mimeType?: string,
    fileName?: string,
    userId?: string
  ): Promise<string> {
    const mime = (mimeType || "image/jpeg").toLowerCase();
    const dataBase64 = buffer.toString("base64");
    const prompt = [
      "You are an OCR and document transcription assistant for U Learn.",
      "Transcribe ALL readable text from this image exactly (Arabic, Kurdish, English, Turkish, math, tables).",
      "Preserve reading order. If it's a worksheet/homework photo, include questions and any handwritten answers.",
      "If the image has diagrams, briefly describe them after the text.",
      "Return plain text only — no markdown fences, no apology if empty (say EMPTY_IMAGE).",
      fileName ? `File name: ${fileName}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const messages: ChatMessage[] = [
      {
        role: "user",
        content: prompt,
        parts: [
          {
            type: "image",
            mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
            dataBase64,
          },
        ],
      },
    ];

    try {
      const result = await AiProviderService.chat("OCR_ANALYSIS", messages, userId).catch(
        async () => AiProviderService.chat("TEACHING_ASSISTANT", messages, userId)
      );
      const text = (result.text || "").trim();
      if (!text || text === "EMPTY_IMAGE") return "";
      return text.slice(0, 16000);
    } catch (e) {
      console.warn(
        "[ocr] image extract failed",
        e instanceof Error ? e.message : e
      );
      return "";
    }
  }

  static async extractFromScannedPdf(
    buffer: Buffer,
    fileName?: string,
    userId?: string
  ): Promise<string> {
    // Best-effort: treat first pages as raw bytes won't work as image.
    // Ask a vision model isn't possible without rasterizing; return empty
    // and let callers try Gemini with a note. For now attempt text-only hint.
    void buffer;
    void fileName;
    void userId;
    return "";
  }

  /** Describe a PDF when text layer is empty — send truncated base64 won't work; skip. */
  static async describeUnreadablePdf(fileName: string, language?: string): Promise<string> {
    const lang = (language || "en").slice(0, 2);
    if (lang === "ar") {
      return `تعذر استخراج نص من الملف "${fileName}" (قد يكون PDF ممسوحًا ضوئيًا). حاول رفع صورة أوضح أو ملف نصي/DOCX.`;
    }
    return `Could not extract text from "${fileName}" (it may be a scanned PDF). Try a clearer photo or a text/DOCX file.`;
  }
}
