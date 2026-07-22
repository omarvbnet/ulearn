import type { ChatAttachmentInput } from "../types";

export type CreativeChatIntent =
  | "merge"
  | "design_ppt"
  | "design_pdf"
  | "design_docx"
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
  const wordDocWords =
    /\b(word|docx|doc\b|microsoft\s*word)\b|وورد|ورڈ|ملف\s*وورد|مستند\s*وورد|word\s*belgesi/i;
  const imageEditWords =
    /\b(edit|improve|redesign|fix|retouch|enhance)\b|عدل|عدّل|حسّن|حسن|تعديل\s*الصور|دەستکاری|düzenle|iyileştir/i;
  const imageDesignWords =
    /(?:design|create|generate|make|draw).{0,48}(?:image|logo|poster|banner|graphic|illustration|icon|picture|infographic|diagram)|(?:صمم|تصميم|أنشئ|انشئ|ارسم|توليد).{0,48}(?:صورة|شعار|بوستر|بانر|رسمة|رسوم|إنفوجرافيك|انفوجرافيك|توضيحية|هندسية)|(?:دروست|دیزاین).{0,48}(?:وێنە|لۆگۆ)|(?:tasarla|oluştur|çiz).{0,48}(?:görsel|logo|afiş|resim)|تصميم\s*صورة|صورة\s*(?:احترافية|جديدة|تعليمية)|رسوم(?:ات)?\s*(?:تعليمية|هندسية|توضيحية)|إنفوجرافيك|انفوجرافيك|logo\s*design|صورة تعليمية|من الملفات المرفقة.*(?:صورة|تصميم)|(?:صورة|تصميم).*(?:المرفق|المرفقة)/i;

  if (pdfs.length >= 2 && (mergeWords.test(ql) || !q)) return "merge";
  if (pdfs.length >= 2 && mergeWords.test(ql)) return "merge";

  if (images.length >= 1 && imageEditWords.test(ql)) return "image_edit";
  if (imageDesignWords.test(ql)) return "image_design";
  if (
    designWords.test(ql) &&
    /image|logo|poster|banner|graphic|picture|صورة|شعار|وێنە|görsel|resim|تعليمية/i.test(
      ql
    )
  ) {
    return "image_design";
  }

  if (
    pptWords.test(ql) &&
    (designWords.test(ql) ||
      /صمم|تصميم|اعمل|سوي|سوی|من الملفات|المرفق/i.test(ql))
  ) {
    return "design_ppt";
  }
  if (wordDocWords.test(ql) && designWords.test(ql)) {
    return "design_docx";
  }
  if (pdfDocWords.test(ql) && designWords.test(ql) && pdfs.length < 2) {
    return "design_pdf";
  }

  return null;
}

export function creativeUpgradeMessage(language: string): string {
  switch (language.slice(0, 2)) {
    case "ar":
      return "انتهت باقة الذكاء الاصطناعي المجانية أو الاشتراك. اضغط ترقية الخطة للاشتراك الشهري (USD) أو السنوي (IQD)، أو أكمل عدد الدورات المطلوب من الإدارة.";
    case "ku":
      return "پلانی خۆڕایی AI یان بەشدارییەکە تەواو بوو. کرتە لەسەر بەرزکردنەوەی پلان بکە بۆ مانگانە (USD) یان ساڵانە (IQD)، یان ژمارەی کۆرسە پێویستەکان تەواو بکە.";
    case "tr":
      return "Ücretsiz AI planınız veya aboneliğiniz bitti. Aylık (USD) veya yıllık (IQD) yükseltmek için Planı Yükselt’e dokunun, ya da yönetici kurs eşiğini tamamlayın.";
    default:
      return "Your free AI plan or subscription has ended. Tap Upgrade Plan for monthly (USD) or yearly (IQD), or reach the admin course unlock count.";
  }
}

export function creativeSuccessMessage(
  language: string,
  intent: CreativeChatIntent
): string {
  const en: Record<CreativeChatIntent, string> = {
    merge: "Merged your PDFs. Tap Download to save the file.",
    design_ppt:
      "Created your presentation with text and professional images. Tap Download to save the PPTX.",
    design_pdf:
      "Created your PDF with text and professional images. Tap Download to save the file.",
    design_docx:
      "Created your Word document with text and professional images. Tap Download to save the DOCX.",
    image_edit: "Edited your image. Tap Download to save the PNG.",
    image_design: "Designed your graphic. Tap Download to save the PNG.",
  };
  const ar: Record<CreativeChatIntent, string> = {
    merge: "تم دمج ملفات PDF. اضغط تنزيل لحفظ الملف.",
    design_ppt:
      "تم إنشاء العرض بالنصوص والصور الاحترافية. اضغط تنزيل لحفظ PPTX.",
    design_pdf:
      "تم إنشاء ملف PDF بالنصوص والصور الاحترافية. اضغط تنزيل لحفظه.",
    design_docx:
      "تم إنشاء مستند Word بالنصوص والصور الاحترافية. اضغط تنزيل لحفظ DOCX.",
    image_edit: "تم تعديل الصورة. اضغط تنزيل لحفظ PNG.",
    image_design: "تم تصميم الرسم. اضغط تنزيل لحفظ PNG.",
  };
  const ku: Record<CreativeChatIntent, string> = {
    merge: "PDFەکان تێکەڵ کران. داگرتن دابگرە بۆ پاشەکەوتکردن.",
    design_ppt:
      "پێشکەشکردن لەگەڵ دەق و وێنەی پیشەیی دروستکرا. داگرتن دابگرە بۆ PPTX.",
    design_pdf: "PDF لەگەڵ دەق و وێنەی پیشەیی دروستکرا. داگرتن دابگرە.",
    design_docx:
      "بەڵگەنامەی Word لەگەڵ دەق و وێنەی پیشەیی دروستکرا. داگرتن دابگرە بۆ DOCX.",
    image_edit: "وێنەکە دەستکاری کرا. داگرتن دابگرە بۆ PNG.",
    image_design: "گرافیکەکە دیزاین کرا. داگرتن دابگرە بۆ PNG.",
  };
  const tr: Record<CreativeChatIntent, string> = {
    merge: "PDF’ler birleştirildi. Kaydetmek için İndir’e dokunun.",
    design_ppt:
      "Metin ve profesyonel görsellerle sunum oluşturuldu. PPTX için İndir’e dokunun.",
    design_pdf:
      "Metin ve profesyonel görsellerle PDF oluşturuldu. Kaydetmek için İndir’e dokunun.",
    design_docx:
      "Metin ve profesyonel görsellerle Word belgesi oluşturuldu. DOCX için İndir’e dokunun.",
    image_edit: "Görsel düzenlendi. PNG kaydetmek için İndir’e dokunun.",
    image_design: "Grafik tasarlandı. PNG kaydetmek için İndir’e dokunun.",
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
