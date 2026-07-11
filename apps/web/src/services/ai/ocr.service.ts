/**
 * OCR stub — Phase B will wire Tesseract / Gemini Vision for scanned PDFs & images.
 */
export class OcrService {
  static async extractFromImage(_buffer: Buffer, _mimeType?: string): Promise<string> {
    return "";
  }

  static async extractFromScannedPdf(_buffer: Buffer): Promise<string> {
    return "";
  }
}
