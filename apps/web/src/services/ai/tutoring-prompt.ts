import { languageInstruction } from "./types";

export type TutoringAudience = "student" | "certificate" | "general";

/**
 * Pedagogical system instructions for U Learn Teaching Assistant.
 * Produces explanations like a skilled human tutor: warm greeting,
 * diagnose gaps, step-by-step worked solutions, everyday analogies,
 * study tips tied to curriculum, and inviting follow-ups.
 */
export function buildTutoringMethodPrompt(input: {
  language?: string | null;
  audience: TutoringAudience;
  studentBlurb?: string;
  memoryBlurb?: string;
  learningCtxBlurb?: string;
}): string {
  const audienceBlock =
    input.audience === "certificate"
      ? [
          "Audience: professional / certificate learner.",
          "Use workplace-ready examples and industry scenarios when helpful.",
          "Keep tone respectful and efficient, but still warm and clear.",
          "Prefer the learner's areas of interest when giving examples.",
        ].join("\n")
      : input.audience === "student"
        ? [
            "Audience: school / university student.",
            "Use age-appropriate everyday analogies (food, sports, money, classroom objects).",
            "Celebrate progress; never shame mistakes — mistakes are learning data.",
            "Address the student by name when natural.",
          ].join("\n")
        : "Audience: general learner. Be a clear, patient tutor.";

  return [
    "You are U Learn Teaching Assistant — an expert personal tutor, not a search box.",
    languageInstruction(input.language),
    audienceBlock,
    input.studentBlurb
      ? `Know this learner: ${input.studentBlurb}`
      : "",
    input.memoryBlurb ? `Learning memory: ${input.memoryBlurb}` : "",
    input.learningCtxBlurb
      ? `\nLearner progress & catalog (use for evaluation and recommendations):\n${input.learningCtxBlurb}`
      : "",
    "",
    "=== EXPLANATION METHOD (always follow for teaching answers) ===",
    "1) OPEN WITH CONTEXT — If you know recent quiz/exam results or weak topics, briefly acknowledge progress or the gap (1–2 sentences). Skip if irrelevant.",
    "2) STATE THE GOAL — Name the concept or problem clearly.",
    "3) BUILD FOUNDATIONS — Define key terms simply (e.g. numerator/denominator) before advanced steps.",
    "4) WORKED STEPS — Numbered steps. One idea per step. Show the reasoning, not only the final answer.",
    "5) ANALOGY OR VISUAL MODEL — Give one concrete everyday analogy or mental picture that matches the concept.",
    "6) RESULT — Highlight the final answer or takeaway clearly (bold).",
    "7) STUDY TIP — Point to what to revise next (lesson/chapter/topic when known from materials). Prefer U Learn curriculum when retrieved.",
    "8) FOLLOW-UPS — End with exactly 1–2 short optional next questions the learner can tap.",
    "",
    "Formatting rules:",
    "- Use Markdown: **bold** for key terms/answers, numbered lists for steps, short paragraphs.",
    "- For fractions/math write clear ASCII or Markdown forms like 1/8 or `f(x) = 2x + 3` (readable on mobile).",
    "- Keep messages scannable: avoid walls of text; prefer short sections with headings when the answer is long.",
    "- Match the learner's language; do not mix languages unless they do.",
    "",
    "Follow-up block (REQUIRED at the end of teaching answers, omit only for pure creative/file jobs):",
    "[[FOLLOW_UPS]]",
    "Short follow-up question 1?",
    "Short follow-up question 2?",
    "[[/FOLLOW_UPS]]",
    "Write follow-ups in the same language as the answer. Make them specific and actionable.",
    "",
    "Anti-patterns to avoid:",
    "- Dumping the answer without steps.",
    "- Dry textbook tone with no encouragement or analogy.",
    "- Inventing that a specific uploaded PDF/page says something it does not.",
    "- Overlong lectures; stop when the learner can try the next problem.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/** Strip machine follow-up block; return display text + chip prompts. */
export function extractFollowUps(raw: string): {
  cleanText: string;
  followUps: string[];
} {
  const re = /\[\[FOLLOW_UPS\]\]([\s\S]*?)\[\[\/FOLLOW_UPS\]\]/i;
  const m = raw.match(re);
  if (!m) {
    return { cleanText: raw.trim(), followUps: [] };
  }
  const followUps = (m[1] || "")
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length >= 4 && l.length <= 160)
    .slice(0, 3);
  const cleanText = raw.replace(re, "").trim();
  return { cleanText, followUps };
}

/** Machine marker blocks that must never reach the live token stream. */
const STREAM_MARKERS: Record<string, string> = {
  "[[FLUX]]": "[[/FLUX]]",
  "[[BOARD]]": "[[/BOARD]]",
  "[[FOLLOW_UPS]]": "[[/FOLLOW_UPS]]",
};

/**
 * Wraps a token callback so machine blocks ([[FLUX]]…, [[FOLLOW_UPS]]…) are
 * suppressed while streaming, even when markers are split across deltas.
 * The final cleaned answer still comes from extractFollowUps/extractFluxFigurePrompts.
 */
export function createMarkerStreamFilter(
  onToken: (text: string) => void
): (delta: string) => void {
  let buf = "";
  let suppressUntil: string | null = null;

  return (delta: string) => {
    buf += delta;
    let out = "";
    for (;;) {
      if (suppressUntil) {
        const end = buf.indexOf(suppressUntil);
        if (end === -1) {
          // Keep a tail in case the closing marker is split across deltas.
          buf = buf.slice(Math.max(0, buf.length - suppressUntil.length + 1));
          break;
        }
        buf = buf.slice(end + suppressUntil.length);
        suppressUntil = null;
        continue;
      }
      const open = buf.indexOf("[[");
      if (open === -1) {
        // Hold back a trailing "[" that may start a marker in the next delta.
        const hold = buf.endsWith("[") ? 1 : 0;
        out += hold ? buf.slice(0, -1) : buf;
        buf = hold ? "[" : "";
        break;
      }
      out += buf.slice(0, open);
      buf = buf.slice(open);
      const opener = Object.keys(STREAM_MARKERS).find((k) => buf.startsWith(k));
      if (opener) {
        suppressUntil = STREAM_MARKERS[opener]!;
        buf = buf.slice(opener.length);
        continue;
      }
      if (Object.keys(STREAM_MARKERS).some((k) => k.startsWith(buf))) {
        break; // possibly an incomplete opener — wait for the next delta
      }
      out += buf.slice(0, 2);
      buf = buf.slice(2);
    }
    if (out) onToken(out);
  };
}
