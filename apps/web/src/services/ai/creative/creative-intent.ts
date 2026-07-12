import type { ChatAttachmentInput } from "../types";

export type CreativeChatIntent =
  | "merge"
  | "design_ppt"
  | "design_pdf"
  | "image_edit"
  | "image_design";

function isPdf(a: { fileName: string; mimeType: string }) {
  return (
    a.mimeType.toLowerCase().includes("pdf") ||
    a.fileName.toLowerCase().endsWith(".pdf")
  );
}

function isImage(a: { fileName: string; mimeType: string }) {
  return (
    a.mimeType.toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|svg)$/i.test(a.fileName)
  );
}

/**
 * Detect Creative Studio actions from natural language + attachments.
 * Used inside AI chat so learners don't need separate tool screens.
 */
export function detectCreativeChatIntent(
  question: string,
  attachments: Array<{ fileName: string; mimeType: string }>
): CreativeChatIntent | null {
  const q = question.trim();
  const ql = q.toLowerCase();
  const pdfs = attachments.filter(isPdf);
  const images = attachments.filter(isImage);

  const mergeWords =
    /\b(merge|combine|join|concat)\b|ادمج|دمج|تێکەڵ|birleştir|birlestir/i;
  const designWords =
    /\b(design|create|generate|make|build|write|draft)\b|صمم|تصميم|أنشئ|انشئ|اكتب|دروست|دیزاین|بونیاد|oluştur|tasarla|hazırla|yaz/i;
  const pptWords =
    /\b(powerpoint|pptx|ppt|presentation|slides?)\b|عرض\s*تقديمي|بوربوينت|بوربوینت|سلايدات?|sunum/i;
  const pdfDocWords =
    /\b(pdf|document|report|handout|essay|article)\b|مذكرة|تقرير|مستند|وثيقة|ڕاپۆرت|belge|rapor|doküman/i;
  const imageEditWords =
    /\b(edit|improve|redesign|fix|retouch|enhance)\b|عدل|عدّل|حسّن|حسن|دەستکاری|düzenle|iyileştir/i;
  const imageDesignWords =
    /(?:design|create|generate|make|draw).{0,48}(?:image|logo|poster|banner|graphic|illustration|icon|picture)|(?:صمم|تصميم|أنشئ|انشئ|ارسم).{0,48}(?:صورة|شعار|بوستر|بانر|رسمة)|(?:دروست|دیزاین).{0,48}(?:وێنە|لۆگۆ)|(?:tasarla|oluştur|çiz).{0,48}(?:görsel|logo|afiş|resim)|تصميم\s*صورة|صورة\s*(?:احترافية|جديدة)|logo\s*design/i;

  if (pdfs.length >= 2 && (mergeWords.test(ql) || !q)) return "merge";
  if (pdfs.length >= 2 && mergeWords.test(ql)) return "merge";

  if (images.length >= 1 && imageEditWords.test(ql)) return "image_edit";
  if (imageDesignWords.test(ql)) return "image_design";
  if (
    designWords.test(ql) &&
    /image|logo|poster|banner|graphic|picture|صورة|شعار|وێنە|görsel|resim/i.test(ql) &&
    images.length === 0
  ) {
    return "image_design";
  }

  // Prefer PPT when user mentions presentation (even without explicit "design")
  if (pptWords.test(ql) && (designWords.test(ql) || /صمم|تصميم|اعمل|سوي|سوی/i.test(ql))) {
    return "design_ppt";
  }
  if (pptWords.test(ql) && designWords.test(ql)) return "design_ppt";
  if (pdfDocWords.test(ql) && designWords.test(ql) && pdfs.length < 2) {
    return "design_pdf";
  }

  return null;
}

export function creativeUpgradeMessage(language: string): string {
  switch (language.slice(0, 2)) {
    case "ar":
      return "انتهت استخدامات الاستوديو الإبداعي المجانية. اشترِ دورة مدفوعة إضافية أو فعّل باقة AI Creative للمتابعة (دمج PDF، تصميم عرض/PDF، الصور).";
    case "ku":
      return "بەکارهێنانی خۆڕایی ستۆدیۆی داهێنەرانە تەواو بوو. کۆرسی پارەدراوی زیاتر بکڕە یان پاکێجی AI Creative چالاک بکە بۆ بەردەوامبوون.";
    case "tr":
      return "Ücretsiz Yaratıcı Stüdyo hakkınız bitti. Devam etmek için daha fazla ücretli kurs alın veya AI Creative paketini etkinleştirin.";
    default:
      return "You've used your free AI Creative Studio uses. Buy more paid courses or activate an AI Creative plan to continue (PDF merge, PPT/PDF design, images).";
  }
}

export function creativeSuccessMessage(
  language: string,
  intent: CreativeChatIntent
): string {
  const en: Record<CreativeChatIntent, string> = {
    merge: "Merged your PDFs. Tap Download to save the file.",
    design_ppt: "Created your presentation. Tap Download to save the PPTX.",
    design_pdf: "Created your PDF. Tap Download to save the file.",
    image_edit: "Edited your image. Tap Download to save the SVG.",
    image_design: "Designed your graphic. Tap Download to save the SVG.",
  };
  const ar: Record<CreativeChatIntent, string> = {
    merge: "تم دمج ملفات PDF. اضغط تنزيل لحفظ الملف.",
    design_ppt: "تم إنشاء العرض. اضغط تنزيل لحفظ ملف PPTX.",
    design_pdf: "تم إنشاء ملف PDF. اضغط تنزيل لحفظه.",
    image_edit: "تم تعديل الصورة. اضغط تنزيل لحفظ SVG.",
    image_design: "تم تصميم الرسم. اضغط تنزيل لحفظ SVG.",
  };
  const ku: Record<CreativeChatIntent, string> = {
    merge: "PDFەکان تێکەڵ کران. داگرتن دابگرە بۆ پاشەکەوتکردن.",
    design_ppt: "پێشکەشکردن دروستکرا. داگرتن دابگرە بۆ PPTX.",
    design_pdf: "PDF دروستکرا. داگرتن دابگرە بۆ پاشەکەوتکردن.",
    image_edit: "وێنەکە دەستکاری کرا. داگرتن دابگرە بۆ SVG.",
    image_design: "گرافیکەکە دیزاین کرا. داگرتن دابگرە بۆ SVG.",
  };
  const tr: Record<CreativeChatIntent, string> = {
    merge: "PDF’ler birleştirildi. Kaydetmek için İndir’e dokunun.",
    design_ppt: "Sunum oluşturuldu. PPTX kaydetmek için İndir’e dokunun.",
    design_pdf: "PDF oluşturuldu. Kaydetmek için İndir’e dokunun.",
    image_edit: "Görsel düzenlendi. SVG kaydetmek için İndir’e dokunun.",
    image_design: "Grafik tasarlandı. SVG kaydetmek için İndir’e dokunun.",
  };
  const lang = language.slice(0, 2);
  if (lang === "ar") return ar[intent];
  if (lang === "ku") return ku[intent];
  if (lang === "tr") return tr[intent];
  return en[intent];
}

export function toCreativeFiles(attachments: ChatAttachmentInput[]) {
  return attachments.map((a) => ({
    fileName: a.fileName,
    mimeType: a.mimeType,
    dataBase64: a.dataBase64,
    fileKey: a.fileKey,
    fileUrl: a.fileUrl,
  }));
}
