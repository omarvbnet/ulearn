declare module "arabic-reshaper" {
  const ArabicReshaper: {
    convertArabic(text: string): string;
    convertArabicBack(text: string): string;
  };
  export default ArabicReshaper;
}

declare module "bidi-js" {
  type EmbeddingLevels = { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> };
  type BidiApi = {
    getEmbeddingLevels(string: string, explicitEmbeddingLevel?: number | null): EmbeddingLevels;
    getReorderedString(
      string: string,
      embedLevels: EmbeddingLevels,
      start?: number | null,
      end?: number | null
    ): string;
  };
  export default function bidiFactory(): BidiApi;
}

declare module "@pdf-lib/fontkit" {
  const fontkit: unknown;
  export default fontkit;
}
