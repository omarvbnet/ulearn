/** Extract [[FLUX]]...[[/FLUX]] figure prompts from DeepSeek markdown. */
export function extractFluxFigurePrompts(markdown: string): {
  cleanMarkdown: string;
  prompts: string[];
} {
  const prompts: string[] = [];
  const cleanMarkdown = markdown.replace(
    /\[\[FLUX\]\]([\s\S]*?)\[\[\/FLUX\]\]/gi,
    (_m, inner: string) => {
      const p = String(inner || "").trim().replace(/\s+/g, " ");
      if (p.length >= 12) prompts.push(p.slice(0, 900));
      return "";
    }
  );
  return {
    cleanMarkdown: cleanMarkdown.replace(/\n{3,}/g, "\n\n").trim(),
    prompts: prompts.slice(0, 5),
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

export function materialSelectMessage(language: string): string {
  switch (language.slice(0, 2)) {
    case "ar":
      return "لاشرح أو الملاحظة مع رسم الأشكال، اختر المادة من مكتبتك أولاً ثم أكّد الاختيار.";
    case "ku":
      return "بۆ ڕوونکردنەوە یان تێبینی لەگەڵ وێنەکێشانی شێوەکان، سەرەتا ماددەکە لە کتێبخانەکەت هەڵبژێرە.";
    case "tr":
      return "Açıklama veya şekil çizimli gözlem için önce kütüphanenden materyali seç.";
    default:
      return "To explain or observe with painted shapes, select the material from your library first, then confirm.";
  }
}
