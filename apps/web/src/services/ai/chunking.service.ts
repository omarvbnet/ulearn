export type TextChunk = {
  text: string;
  pageNumber?: number;
  heading?: string;
};

const MAX_CHARS = 1200;
const OVERLAP = 150;

/**
 * Semantic-ish chunking: split by headings / paragraphs, then soft-cap length.
 * Avoids naive fixed-character slicing across sentence boundaries when possible.
 */
export class ChunkingService {
  static chunk(raw: string, opts?: { language?: string }): TextChunk[] {
    const text = raw.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
    if (!text) return [];

    const sections = splitSections(text);
    const chunks: TextChunk[] = [];

    for (const section of sections) {
      const pieces = softSplit(section.body, MAX_CHARS, OVERLAP);
      for (const piece of pieces) {
        const t = piece.trim();
        if (t.length < 40) continue;
        chunks.push({
          text: section.heading ? `${section.heading}\n${t}` : t,
          pageNumber: section.page,
          heading: section.heading,
        });
      }
    }

    if (!chunks.length && text.length >= 40) {
      return softSplit(text, MAX_CHARS, OVERLAP).map((t) => ({ text: t }));
    }

    return chunks;
  }
}

function splitSections(text: string): { heading?: string; body: string; page?: number }[] {
  // Form-feed or explicit page markers from PDF extractors
  const pages = text.split(/\f|\n={3,}\s*PAGE\s+\d+\s*={3,}\n/i);
  const out: { heading?: string; body: string; page?: number }[] = [];

  pages.forEach((pageText, pageIdx) => {
    const page = pages.length > 1 ? pageIdx + 1 : undefined;
    const parts = pageText.split(/\n(?=#{1,3}\s|[A-Z][A-Z0-9 \-]{8,}\n|[٠-٩\d]+\.\s+[^\n]{8,}\n)/);
    for (const part of parts) {
      const lines = part.trim().split("\n");
      if (!lines.length) continue;
      const first = lines[0]!.trim();
      const looksHeading =
        /^#{1,3}\s/.test(first) ||
        (/^[A-Z][A-Z0-9 \-]{8,}$/.test(first) && first.length < 80) ||
        /^\d+(\.\d+)*\s+\S/.test(first);
      if (looksHeading && lines.length > 1) {
        out.push({ heading: first.replace(/^#+\s*/, ""), body: lines.slice(1).join("\n"), page });
      } else {
        out.push({ body: part, page });
      }
    }
  });

  return out.length ? out : [{ body: text }];
}

function softSplit(text: string, max: number, overlap: number): string[] {
  if (text.length <= max) return [text];
  const paras = text.split(/\n{2,}/);
  const result: string[] = [];
  let buf = "";

  const flush = () => {
    if (buf.trim()) result.push(buf.trim());
    buf = "";
  };

  for (const para of paras) {
    if ((buf + "\n\n" + para).length <= max) {
      buf = buf ? `${buf}\n\n${para}` : para;
      continue;
    }
    if (buf) flush();
    if (para.length <= max) {
      buf = para;
      continue;
    }
    // sentence-aware hard split
    let start = 0;
    while (start < para.length) {
      let end = Math.min(start + max, para.length);
      if (end < para.length) {
        const slice = para.slice(start, end);
        const breakAt = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
        if (breakAt > max * 0.4) end = start + breakAt + 1;
      }
      result.push(para.slice(start, end).trim());
      start = Math.max(end - overlap, end);
    }
  }
  flush();
  return result.filter(Boolean);
}
