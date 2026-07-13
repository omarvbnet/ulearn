import { hasArabicScript, isRtlLanguage } from "../fonts";

/**
 * Art-direction wrapper for FLUX educational paintings.
 * DeepSeek writes labels separately; FLUX paints shapes only for RTL.
 */
export function buildAmazingFluxPaintPrompt(input: {
  subjectPrompt: string;
  language?: string | null;
  context?: string;
  purpose?: "standalone" | "document_figure" | "observation";
}): string {
  const purpose = input.purpose || "standalone";
  const rtl =
    isRtlLanguage(input.language) ||
    hasArabicScript(`${input.subjectPrompt}\n${input.context || ""}`);

  const purposeLine =
    purpose === "document_figure"
      ? "Role: premium textbook / slide figure for a student study pack (print-ready)."
      : purpose === "observation"
        ? "Role: crystal-clear observation diagram so a student can study shapes carefully."
        : "Role: stunning educational illustration / infographic for mobile learning.";

  const arabicPolicy = rtl
    ? [
        "CRITICAL TEXT POLICY:",
        "- Do NOT paint Arabic, Kurdish, or any RTL letters (they corrupt).",
        "- Shapes, arrows, icons, color regions, and diagrams only.",
        "- Tiny Latin markers A/B/C or 1/2/3 allowed.",
        "- Leave a clean empty bottom band (~15%) for professional typography overlay.",
      ].join("\n")
    : [
        "TEXT POLICY:",
        "- Keep any labels short, sharp, high-contrast, and correctly spelled.",
        "- Prefer icons + shapes over dense paragraphs of text.",
      ].join("\n");

  return [
    purposeLine,
    "Art direction (must follow):",
    "- Award-winning educational illustration quality — vivid but readable.",
    "- High contrast, accurate geometry, crisp edges, balanced composition.",
    "- Soft depth (subtle shadows / layered planes), no muddy blur.",
    "- Harmonious academic color palette (deep teal, coral accents, clean whites) — avoid neon purple glow clutter.",
    "- Center the main idea; generous margins; textbook clarity first.",
    "- Infographic polish: clear visual hierarchy, consistent stroke weight.",
    arabicPolicy,
    `Subject to paint:\n${input.subjectPrompt.slice(0, 1200)}`,
    input.context
      ? `Curriculum context (shapes/concepts only — do not copy long text):\n${input.context.slice(0, 900)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
