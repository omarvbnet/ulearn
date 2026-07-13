import {
  extractEducationalLabels,
  parseFluxBlock,
} from "../arabic-image-text";

/** Extract [[FLUX]]...[[/FLUX]] figure prompts from DeepSeek markdown. */
export function extractFluxFigurePrompts(markdown: string): {
  cleanMarkdown: string;
  prompts: string[];
  figures: Array<{ prompt: string; labels: string[] }>;
} {
  const prompts: string[] = [];
  const figures: Array<{ prompt: string; labels: string[] }> = [];
  const cleanMarkdown = markdown.replace(
    /\[\[FLUX\]\]([\s\S]*?)\[\[\/FLUX\]\]/gi,
    (_m, inner: string) => {
      const raw = String(inner || "").trim();
      if (raw.length < 12) return "";
      const parsed = parseFluxBlock(raw);
      const prompt = parsed.prompt.slice(0, 900);
      const labels =
        parsed.labels.length > 0
          ? parsed.labels
          : extractEducationalLabels(raw);
      prompts.push(prompt);
      figures.push({ prompt, labels });
      return "";
    }
  );
  return {
    cleanMarkdown: cleanMarkdown.replace(/\n{3,}/g, "\n\n").trim(),
    prompts: prompts.slice(0, 5),
    figures: figures.slice(0, 5),
  };
}

export type DesignFigure = {
  pngBase64: string;
  caption?: string;
};

/** Detect explain / observe / material-study intents that need KB selection. */
export function detectExplainObserveIntent(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  return (
    /\b(explain|observe|observation|illustrate|visualize|walk\s*me\s*through|break\s*down)\b/i.test(
      q
    ) ||
    /اشرح|شرح|وضّح|وضح|لاحظ|ملاحظة|راقِب|راقب|راقب الشكل|لاحظ الشكل|توضيح|تفسير|فهم المادة|فهم الدرس/i.test(
      q
    ) ||
    /ڕوون|شیکار|تێبینی|سەیر|بینین/i.test(q) ||
    /\b(anlat|açıkla|gözlem|incele|görselleştir)\b/i.test(q)
  );
}

/** Small talk / meta — do not force material picker. */
export function isChitchatOrMeta(question: string): boolean {
  const q = question.trim();
  if (q.length < 3) return true;
  if (q.length > 80) return false;
  return (
    /^(hi|hello|hey|thanks|thank you|ok|okay|bye|good\s*morning|good\s*evening)\b/i.test(
      q
    ) ||
    /^(مرحبا|اهلا|أهلا|السلام|شكرا|شكراً|تمام|باي|صباح|مساء)/i.test(q) ||
    /^(سڵاو|سوپاس|باشە)/i.test(q) ||
    /^(merhaba|selam|teşekkür|tamam)\b/i.test(q) ||
    /\b(who are you|what can you do|help me use|كيف أستخدم|شنو تكدر)\b/i.test(q)
  );
}

/**
 * If the user already named a library file, return matching document ids
 * so we can skip the picker. Dedupes by normalized file name (one id each).
 */
export function matchMentionedMaterials(
  question: string,
  docs: Array<{ id: string; fileName: string }>
): string[] {
  const q = question.toLowerCase();
  const hits: string[] = [];
  const seenNames = new Set<string>();
  for (const d of docs) {
    const name = d.fileName.replace(/\.[^.]+$/, "").toLowerCase();
    const compact = name.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
    const key = compact || name;
    if (key.length < 3) continue;
    if (!(q.includes(compact) || q.includes(name) || q.includes(key))) continue;
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    hits.push(d.id);
  }
  return hits;
}

/** Keep one entry per normalized file name (latest wins if callers sort desc). */
export function dedupeMaterialsByFileName<
  T extends { id: string; fileName: string },
>(docs: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of docs) {
    const key = d.fileName
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[_\-.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export type MaterialOption = {
  id: string;
  fileName: string;
  pageCount?: number | null;
};

export function materialSelectMessage(
  language: string,
  materials?: MaterialOption[]
): string {
  const unique = materials ? dedupeMaterialsByFileName(materials) : [];
  // Keep the prompt short — the app renders tappable material buttons separately.
  switch (language.slice(0, 2)) {
    case "ar":
      return unique.length
        ? "لتجيبك من مواد مرحلتك بدقة، اضغط على مادة واحدة من الأزرار بالأسفل:"
        : "لا توجد مواد جاهزة بعد — اطلب من الإدارة رفعها في المعرفة الأساسية.";
    case "ku":
      return unique.length
        ? "بۆ وەڵامدانەوەی ورد، کرتە لەسەر یەکێک لە دوگمەکانی ماددە بکە:"
        : "هیچ ماددەیەکی ئامادە نییە — داوا لە بەڕێوەبەر بکە باریان بکات.";
    case "tr":
      return unique.length
        ? "Doğru yanıt için aşağıdaki materyal düğmelerinden birine dokun:"
        : "Hazır materyal yok — yöneticinin Temel Bilgi’ye yüklemesini iste.";
    default:
      return unique.length
        ? "To answer from your stage materials, tap one of the material buttons below:"
        : "No READY materials yet — ask an admin to upload them in Basic Knowledge.";
  }
}
