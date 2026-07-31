/**
 * Derive real subject/topic titles from textbook chunks — never cover-page
 * teacher names, PDF filenames, grade banners, or "Pages 1–3".
 */

/** Remove Arabic tatweel (kashida) + diacritics — PDF covers stretch words
 * like "الاســتاذ اركـــان" which defeats plain-text regex matching. */
function stripArabicNoise(s: string): string {
  return String(s || "")
    .replace(/\u0640/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "");
}

function norm(s: string): string {
  return stripArabicNoise(String(s || ""))
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cover / catalog lines that must never become the lesson title. */
export function isCoverOrMetaLine(
  line: string,
  materialNames: string[] = []
): boolean {
  const raw = stripArabicNoise(String(line || ""))
    .replace(/\s+/g, " ")
    .trim();
  if (!raw || raw.length < 3) return true;
  if (/^https?:/i.test(raw) || /^\d+$/.test(raw)) return true;
  if (/^pages?\s*\d+/i.test(raw)) return true;
  if (
    /^(contents|index|references|bibliography|introduction|intro|محتويات|فهرس|مقدمة|المقدمة)$/i.test(
      raw
    )
  ) {
    return true;
  }
  // Teacher / school / ministry cover banners (Arabic + English).
  // Note: JS `\b` is ASCII-only — do not rely on it for Arabic tokens.
  if (
    /^(?:الأستاذ|الاستاذ|استاذ|الأستاذه|الاستاذه|مدرس|المدرس|المعلم|المعلمة|أ\.|م\.|teacher|prof\.?|dr\.?)\s/i.test(
      raw + " "
    ) ||
    /(?:الأستاذ|الاستاذ|استاذ|مدرس|المدرس|المعلم)\s+\S+/.test(raw)
  ) {
    return true;
  }
  if (
    /^(وزارة|مديرية|مديرية التربية|إعداد|تأليف|مدرسة|ثانوية|متوسطة)\b/i.test(
      raw
    )
  ) {
    return true;
  }
  // Bare stage/subject banners without a concept ("فيزياء الثالث", "Grade 9 Physics").
  if (
    /^(فيزياء|كيمياء|رياضيات|احياء|أحياء|عربي|انكليزي|English|Math|Physics|Chemistry)\b/i.test(
      raw
    ) &&
    raw.split(/\s+/).length <= 5 &&
    /(الثالث|الرابع|الخامس|السادس|متوسط|اعداد|إعداد|grade|class|year)/i.test(raw)
  ) {
    return true;
  }
  const n = norm(raw);
  for (const name of materialNames) {
    const mn = norm(name);
    if (!mn || mn.length < 4) continue;
    if (n === mn || n.includes(mn) || mn.includes(n)) return true;
    // Filename stem overlap (first 3+ tokens).
    const a = n.split(" ").filter((w) => w.length > 2).slice(0, 4);
    const b = mn.split(" ").filter((w) => w.length > 2).slice(0, 4);
    if (a.length >= 2 && b.length >= 2) {
      const overlap = a.filter((w) => b.includes(w)).length;
      if (overlap >= Math.min(3, a.length, b.length)) return true;
    }
  }
  return false;
}

export function isPageLessonLabel(title: string | null | undefined): boolean {
  return /^pages?\s*\d+/i.test(String(title || "").trim());
}

export function isWeakLessonTitle(
  title: string | null | undefined,
  materialNames: string[] = []
): boolean {
  const t = String(title || "").trim();
  if (!t) return true;
  if (isPageLessonLabel(t)) return true;
  if (isCoverOrMetaLine(t, materialNames)) return true;
  if (/^lesson\s+\d+$/i.test(t)) return true;
  if (/^الوحدة\s+\d+$/u.test(t) && t.split(/\s+/).length <= 2) return true;
  return false;
}

/** Pull a short subject title from chunk text — never cover/meta lines. */
export function topicTitleFromChunkText(
  texts: string[],
  fallbackIndex = 1,
  materialNames: string[] = []
): string {
  const lines: string[] = [];
  for (const raw of texts) {
    for (const line of String(raw || "").split(/\n+/)) {
      const cleaned = stripArabicNoise(line)
        .replace(/^#+\s*/, "")
        .replace(/^\d+(\.\d+)*[.)]?\s+/, "")
        .replace(/^pages?\s+\d+.*/i, "")
        .replace(/\bpage\s*\d+\b/gi, "")
        .replace(/^\[[^\]]+\]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) continue;
      lines.push(cleaned);
    }
  }

  // Prefer mid-document lines — covers sit at the top.
  const order = [
    ...lines.slice(Math.min(6, Math.floor(lines.length * 0.15))),
    ...lines.slice(0, 6),
  ];
  const seen = new Set<string>();
  for (const cleaned of order) {
    const key = norm(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    if (cleaned.length < 6 || cleaned.length > 72) continue;
    if (isCoverOrMetaLine(cleaned, materialNames)) continue;
    const words = cleaned.split(/\s+/);
    if (words.length >= 2 && words.length <= 12) return cleaned.slice(0, 60);
  }

  // Fall back to a short concept phrase from body words (skip meta tokens).
  const stop = new Set(
    [
      "the",
      "and",
      "for",
      "with",
      "this",
      "that",
      "from",
      "الاستاذ",
      "الأستاذ",
      "استاذ",
      "مدرس",
      "فيزياء",
      "الثالث",
      "متوسط",
      "اعدادي",
      "إعدادي",
    ].map(norm)
  );
  const words = lines
    .join(" ")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter((w) => w.length > 2 && !stop.has(norm(w)))
    .slice(0, 8);
  if (words.length >= 2) {
    const phrase = words.slice(0, 5).join(" ").slice(0, 48);
    if (!isCoverOrMetaLine(phrase, materialNames)) return phrase;
  }
  return `الوحدة ${fallbackIndex}`;
}

function scrubExcerptLine(line: string, materialNames: string[]): string | null {
  const l = stripArabicNoise(String(line || ""))
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\s*·\s*Pages?\s+\d+\s*[–\-]\s*\d+/gi, "")
    .replace(/\bPages?\s+\d+\s*[–\-]\s*\d+\b/gi, "")
    .replace(/\b(page|صفحة|sayfa)\s*\d+\b/gi, "")
    .trim();
  if (!l || /^---/.test(l)) return null;
  if (isCoverOrMetaLine(l, materialNames)) return null;
  return l;
}

/** Clean excerpt for the teacher prompt — drop filenames, pages, cover lines. */
export function cleanMaterialExcerpt(
  text: string,
  materialNames: string[] = []
): string {
  const parts = String(text || "")
    .split(/\n\n---\n\n/)
    .map((block) => {
      const kept: string[] = [];
      for (const line of block.split(/\n+/)) {
        const l = scrubExcerptLine(line, materialNames);
        if (l) kept.push(l);
      }
      return kept.join("\n").trim();
    })
    .filter((b) => b.length > 24);

  if (!parts.length) {
    // Last resort: line-filter the whole blob (still drop cover/meta).
    const kept: string[] = [];
    for (const line of String(text || "").split(/\n+/)) {
      const l = scrubExcerptLine(line, materialNames);
      if (l) kept.push(l);
    }
    return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return parts.join("\n\n---\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function topicFromExcerpt(
  excerpt: string,
  fallback: string,
  materialNames: string[] = []
): string {
  const lines = excerpt
    .split(/\n+/)
    .map((l) => stripArabicNoise(l).replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter((l) => l.length >= 6 && !/^---/.test(l));
  const order = [
    ...lines.slice(Math.min(4, Math.floor(lines.length * 0.2))),
    ...lines.slice(0, 10),
  ];
  for (const line of order) {
    if (isCoverOrMetaLine(line, materialNames)) continue;
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 12 && line.length <= 60) {
      return line.slice(0, 48);
    }
  }
  const title = topicTitleFromChunkText([excerpt], 1, materialNames);
  return isWeakLessonTitle(title, materialNames) ? fallback : title;
}

/** Short concept label for the board that is not already written. */
export function nextBoardTopicFromExcerpt(
  excerpt: string,
  already: string[],
  materialNames: string[] = [],
  fallback = "فكرة الدرس"
): string {
  const alreadyNorm = new Set(already.map((s) => norm(s).slice(0, 24)));
  const lines = excerpt
    .split(/\n+/)
    .map((l) => stripArabicNoise(l).replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean);
  for (const line of lines) {
    if (isCoverOrMetaLine(line, materialNames)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 10 || line.length > 48) continue;
    const candidate = line.slice(0, 28);
    const key = norm(candidate).slice(0, 24);
    if (alreadyNorm.has(key)) continue;
    if ([...alreadyNorm].some((a) => a && (key.includes(a) || a.includes(key))))
      continue;
    return candidate;
  }
  return fallback;
}
