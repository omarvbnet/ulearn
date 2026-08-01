import { prisma } from "@/lib/prisma";
import { AiProviderService } from "./ai-provider.service";
import { EmbeddingService } from "./embedding.service";
import { VectorSearchService } from "./vector-search.service";
import { QuizService } from "@/services/quiz.service";
import { languageInstruction } from "./types";
import {
  sanitizeBoardFigure,
  type BoardFigureSpec,
} from "./board-figures";
import type { Prisma } from "@prisma/client";

export type GeneratedQuestion = {
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE";
  textEn: string;
  textAr: string;
  textKu: string;
  textTr: string;
  options: Record<string, string>;
  correctKey: string;
  points?: number;
};

export type PracticeQuizPayload = {
  title: string;
  questions: Array<{
    text: string;
    options: Record<string, string>;
    correctKey: string;
    /** Legacy FLUX-painted diagram (kept for old attempts/clients). */
    imageBase64?: string;
    /** Whiteboard diagram drawn by the model (ubrd-figure spec). */
    boardFigure?: BoardFigureSpec;
  }>;
  citations: Array<{ documentName: string; page: number | null }>;
};

type PracticeQuestion = PracticeQuizPayload["questions"][number];

function normalizeLang(raw?: string | null): string {
  const v = (raw || "en").toLowerCase();
  if (v.startsWith("ar")) return "ar";
  if (v.startsWith("ku")) return "ku";
  if (v.startsWith("tr")) return "tr";
  return "en";
}

/** Recover complete question objects from truncated model JSON. */
function extractQuestionsFromPartial(raw: string): {
  title: string | null;
  questions: Array<Record<string, unknown>>;
} {
  let title: string | null = null;
  const titleMatch = raw.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (titleMatch) {
    try {
      title = JSON.parse(`"${titleMatch[1]}"`) as string;
    } catch {
      title = titleMatch[1];
    }
  }

  const qIdx = raw.indexOf('"questions"');
  if (qIdx < 0) return { title, questions: [] };
  const arrStart = raw.indexOf("[", qIdx);
  if (arrStart < 0) return { title, questions: [] };

  const questions: Array<Record<string, unknown>> = [];
  let i = arrStart + 1;
  while (i < raw.length) {
    while (i < raw.length && /[\s,]/.test(raw[i]!)) i++;
    if (i >= raw.length || raw[i] === "]") break;
    if (raw[i] !== "{") break;

    let depth = 0;
    let inStr = false;
    let esc = false;
    const start = i;
    let closed = false;
    for (; i < raw.length; i++) {
      const ch = raw[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          closed = true;
          try {
            questions.push(JSON.parse(raw.slice(start, i)) as Record<string, unknown>);
          } catch {
            // skip malformed object
          }
          break;
        }
      }
    }
    if (!closed) break; // truncated mid-object
  }

  return { title, questions };
}

function parseQuizJson(text: string): {
  title?: string;
  questions?: Array<{
    text?: string;
    options?: Record<string, string>;
    correctKey?: string;
  }>;
} {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] || text).trim();

  const tryParse = (s: string) => {
    return JSON.parse(s) as {
      title?: string;
      questions?: Array<{
        text?: string;
        options?: Record<string, string>;
        correctKey?: string;
      }>;
    };
  };

  try {
    return tryParse(raw);
  } catch {
    /* continue */
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return tryParse(raw.slice(start, end + 1));
    } catch {
      /* continue */
    }
  }

  const salvaged = extractQuestionsFromPartial(raw);
  if (salvaged.questions.length) {
    return {
      title: salvaged.title || undefined,
      questions: salvaged.questions as Array<{
        text?: string;
        options?: Record<string, string>;
        correctKey?: string;
      }>,
    };
  }

  throw new Error(
    "Model did not return valid quiz JSON (response may have been truncated). Try Intermediate (10) or Basic (5), or retry Advanced."
  );
}

function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let s = seed >>> 0 || 1;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function maxTokensForCount(count: number): number {
  if (count >= 20) return 8192;
  if (count >= 10) return 6144;
  return 4096;
}

const FOCUS_ANGLES = [
  "definitions and precise terminology",
  "practical real-world application",
  "cause and effect / why it happens",
  "compare and contrast related ideas",
  "scenario-based problem solving",
  "common misconceptions and traps",
  "step-by-step procedures and order",
  "diagnosis / what went wrong",
  "safety rules and best practices",
  "numbers, units, formulas, and limits",
] as const;

export class ExamGeneratorService {
  static async generatePractice(input: {
    userId: string;
    question: string;
    language?: string | null;
    educationalStageId?: string | null;
    subjectIds?: string[];
    documentIds?: string[];
    attachmentText?: string;
    count?: number;
    requireDocuments?: boolean;
    chapterHeading?: string | null;
    chunkFrom?: number | null;
    chunkTo?: number | null;
  }): Promise<PracticeQuizPayload> {
    const language = normalizeLang(input.language);
    const count = Math.min(Math.max(input.count ?? 5, 3), 20);
    const requestSeed = (Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;

    if (input.requireDocuments && !input.documentIds?.length) {
      throw new Error("Select at least one knowledge document before generating an exam");
    }

    const [material, recent] = await Promise.all([
      this.loadMaterialText({
        userId: input.userId,
        question: input.question,
        educationalStageId: input.educationalStageId,
        subjectIds: input.subjectIds,
        documentIds: input.documentIds,
        attachmentText: input.attachmentText,
        allowRagFallback: !input.requireDocuments,
        sampleSeed: requestSeed,
        chapterHeading: input.chapterHeading,
        chunkFrom: input.chunkFrom,
        chunkTo: input.chunkTo,
      }),
      this.loadRecentExamContext(input.userId),
    ]);

    const angle =
      FOCUS_ANGLES[(recent.attemptCount + requestSeed) % FOCUS_ANGLES.length];
    const secondaryAngle =
      FOCUS_ANGLES[(recent.attemptCount + requestSeed + 3) % FOCUS_ANGLES.length];

    const batchSize = count > 10 ? 10 : count;
    const batches: Array<{ title: string | null; questions: PracticeQuestion[] }> = [];
    let avoid = [...recent.questionTexts];
    let remaining = count;
    let batchIndex = 0;

    while (remaining > 0 && batchIndex < 3) {
      const n = Math.min(batchSize, remaining);
      const batch = await this.runQuizGeneration({
        userId: input.userId,
        language,
        count: n,
        materialText: material.text,
        userFocus: input.question,
        requestSeed: (requestSeed + batchIndex * 9973) >>> 0,
        angle: FOCUS_ANGLES[(recent.attemptCount + requestSeed + batchIndex) % FOCUS_ANGLES.length],
        secondaryAngle:
          FOCUS_ANGLES[
            (recent.attemptCount + requestSeed + batchIndex + 3) % FOCUS_ANGLES.length
          ],
        avoidQuestions: avoid,
        weakTopics: recent.weakHints,
        attemptNumber: recent.attemptCount + 1 + batchIndex,
      });
      if (!batch.questions.length) break;
      batches.push(batch);
      avoid = [...avoid, ...batch.questions.map((q) => q.text)];
      remaining = count - batches.reduce((s, b) => s + b.questions.length, 0);
      batchIndex += 1;
      if (batch.questions.length < Math.min(3, n)) break;
    }

    let generated = {
      title: batches.find((b) => b.title)?.title || null,
      questions: batches.flatMap((b) => b.questions).slice(0, count),
    };

    if (count <= 10) {
      const overlap = this.countOverlap(
        generated.questions.map((q) => q.text),
        recent.questionTexts
      );
      if (overlap >= Math.max(2, Math.floor(count / 2))) {
        generated = await this.runQuizGeneration({
          userId: input.userId,
          language,
          count,
          materialText: material.text,
          userFocus: input.question,
          requestSeed: (requestSeed + 7919) >>> 0,
          angle: secondaryAngle,
          secondaryAngle: angle,
          avoidQuestions: [
            ...recent.questionTexts,
            ...generated.questions.map((q) => q.text),
          ],
          weakTopics: recent.weakHints,
          attemptNumber: recent.attemptCount + 1,
          forceUnique: true,
        });
      }
    }

    if (generated.questions.length < 2) {
      throw new Error("Could not generate enough quiz questions from the selected materials");
    }

    if (count >= 20 && generated.questions.length < 10) {
      throw new Error(
        "Advanced exam was truncated. Please retry Advanced, or try Intermediate (10)."
      );
    }

    const titleSuffix = (requestSeed % 900) + 100;
    const baseTitle = generated.title?.trim() || "Practice quiz";

    const questionsWithShapes = await this.drawExamBoardFigures({
      userId: input.userId,
      language,
      materialText: material.text,
      questions: generated.questions,
    });

    return {
      title: `${baseTitle} · #${titleSuffix}`,
      questions: questionsWithShapes,
      citations: material.citations,
    };
  }

  /**
   * When materials describe shapes/diagrams, ask the model to DRAW matching
   * whiteboard figures (ubrd-figure specs) for those questions — same board
   * technique as chat, no FLUX raster generation.
   */
  private static async drawExamBoardFigures(input: {
    userId: string;
    language: string;
    materialText: string;
    questions: PracticeQuestion[];
  }): Promise<PracticeQuestion[]> {
    const hasShapes =
      /(شكل|رسم|مخطط|هندس|دائرة|مثلث|مستطيل|diagram|figure|shape|geometry|triangle|circle|graph)/i.test(
        `${input.materialText}\n${input.questions.map((q) => q.text).join("\n")}`
      );
    if (!hasShapes || !input.questions.length) return input.questions;

    try {
      const plan = await AiProviderService.chat(
        "EXAM_GENERATOR",
        [
          {
            role: "system",
            content: [
              "Return compact JSON only. No markdown, no commentary.",
              'Schema: {"figures":[{"questionIndex":0,"board":{"title":"short caption","shapes":[{"kind":"rect|circle|line|arrow","x1":0,"y1":0,"x2":0,"y2":0,"color":"#2563EB","width":5}],"texts":[{"x":0,"y":0,"text":"label","color":"#111827","fontSize":40}],"strokes":[{"color":"#EF4444","width":5,"points":[{"x":0,"y":0},{"x":0,"y":0}]}]}}]}',
              "For questions that refer to shapes/diagrams in the material, DRAW the SAME diagram on a 1920x1080 whiteboard (origin top-left, white background).",
              "Plan the layout like a professional teacher: large clear elements, no overlapping labels.",
              `Text labels short and in the question language (${input.language}), fontSize 28-56.`,
              "Ink palette: #111827, #2563EB, #EF4444, #22C55E, #F59E0B.",
              "questionIndex is 0-based. Max 3 figures. Skip questions that need no diagram.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Questions:\n${input.questions
                .map((q, i) => `${i}. ${q.text}`)
                .join("\n")}`,
              `\nMaterial excerpt:\n${input.materialText.slice(0, 6000)}`,
            ].join("\n"),
          },
        ],
        input.userId,
        { maxTokens: 3000, temperature: 0.3, disableThinking: true }
      );

      const raw = (plan.text || "").trim();
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const body = (fenced?.[1] || raw).trim();
      const start = body.indexOf("{");
      const end = body.lastIndexOf("}");
      const parsed = JSON.parse(
        start >= 0 && end > start ? body.slice(start, end + 1) : body
      ) as {
        figures?: Array<{ questionIndex?: number; board?: unknown }>;
      };
      const figures = Array.isArray(parsed.figures)
        ? parsed.figures.slice(0, 3)
        : [];

      const out = input.questions.map((q) => ({ ...q }));
      for (const fig of figures) {
        const idx = Number(fig.questionIndex);
        if (!Number.isFinite(idx) || idx < 0 || idx >= out.length) continue;
        const board = sanitizeBoardFigure(fig.board, idx);
        if (board) out[idx] = { ...out[idx]!, boardFigure: board };
      }
      return out;
    } catch (e) {
      console.warn(
        "[exam] board figure planning failed",
        e instanceof Error ? e.message : e
      );
      return input.questions;
    }
  }

  private static countOverlap(generated: string[], previous: string[]): number {
    const prev = previous.map(normalizeQuestionText).filter((t) => t.length > 12);
    let hits = 0;
    for (const g of generated) {
      const n = normalizeQuestionText(g);
      if (n.length < 12) continue;
      if (
        prev.some(
          (p) =>
            p === n ||
            (p.length > 20 && n.includes(p.slice(0, Math.min(40, p.length)))) ||
            (n.length > 20 && p.includes(n.slice(0, Math.min(40, n.length))))
        )
      ) {
        hits += 1;
      }
    }
    return hits;
  }

  private static async loadRecentExamContext(userId: string) {
    const attempts = await prisma.aiExamAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        questions: true,
        percentage: true,
        passed: true,
        title: true,
      },
    });

    const questionTexts: string[] = [];
    const weakHints: string[] = [];

    for (const a of attempts) {
      const qs = Array.isArray(a.questions) ? a.questions : [];
      for (const raw of qs) {
        if (!raw || typeof raw !== "object") continue;
        const text =
          typeof (raw as { text?: unknown }).text === "string"
            ? String((raw as { text: string }).text).trim()
            : "";
        if (text) questionTexts.push(text);
      }
      if (a.passed === false || (typeof a.percentage === "number" && a.percentage < 60)) {
        if (a.title) weakHints.push(a.title);
        for (const raw of qs.slice(0, 3)) {
          if (
            raw &&
            typeof raw === "object" &&
            typeof (raw as { text?: unknown }).text === "string"
          ) {
            weakHints.push(String((raw as { text: string }).text));
          }
        }
      }
    }

    return {
      attemptCount: attempts.length,
      questionTexts: questionTexts.slice(0, 40),
      weakHints: [...new Set(weakHints)].slice(0, 12),
    };
  }

  private static async runQuizGeneration(input: {
    userId: string;
    language: string;
    count: number;
    materialText: string;
    userFocus?: string;
    requestSeed: number;
    angle: string;
    secondaryAngle: string;
    avoidQuestions: string[];
    weakTopics: string[];
    attemptNumber: number;
    forceUnique?: boolean;
  }): Promise<{ title: string | null; questions: PracticeQuestion[] }> {
    const avoidBlock =
      input.avoidQuestions.length > 0
        ? [
            "Do NOT repeat or lightly rephrase any of these previous questions:",
            ...input.avoidQuestions
              .slice(0, 20)
              .map((t, i) => `${i + 1}. ${t.slice(0, 180)}`),
          ].join("\n")
        : "This learner has few prior exams — still make questions fresh and non-generic.";

    const weakBlock =
      input.weakTopics.length > 0
        ? `Prior weak areas to probe differently (new wording, new scenarios): ${input.weakTopics
            .slice(0, 8)
            .join(" | ")}`
        : "";

    const materialCap = input.count >= 10 ? 8000 : 12000;

    const prompt = [
      "Generate a practice quiz as compact JSON only. No markdown, no commentary.",
      languageInstruction(input.language),
      `Create exactly ${input.count} multiple-choice questions from the material.`,
      'Schema: {"title":"...","questions":[{"text":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctKey":"A"}]}',
      "STRICT: Use ONLY the provided material/chapter text. Do not invent topics outside it.",
      "correctKey must be one of A|B|C|D. Every question must be answerable from the material.",
      "When the material contains shapes/diagrams/figures, write at least one question that refers to those shapes so they can be painted for the student.",
      "Keep stems and options concise (1–2 short sentences). Close every brace/bracket — incomplete JSON is invalid.",
      `Uniqueness token: exam-${input.requestSeed}-n${input.attemptNumber}.`,
      `Primary focus angle: ${input.angle}.`,
      `Also include at least one question using: ${input.secondaryAngle}.`,
      "Mix difficulty. Vary stems. Plausible distractors. Spread correctKey across A/B/C/D.",
      input.forceUnique
        ? "CRITICAL: Invent completely new stems, options, and scenarios vs prior exams."
        : "",
      avoidBlock,
      weakBlock,
      input.userFocus ? `User focus: ${input.userFocus}` : "",
      `\nMaterial sample:\n${input.materialText.slice(0, materialCap)}`,
    ]
      .filter(Boolean)
      .join("\n");

    const chatOpts = {
      maxTokens: maxTokensForCount(input.count),
      temperature: 0.55,
      // Reasoning models burn the budget on hidden thinking, truncating the
      // quiz JSON mid-array ("did not return valid quiz JSON" errors).
      disableThinking: true,
    };

    const result = await AiProviderService.chat(
      "EXAM_GENERATOR",
      [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Return ONLY valid complete JSON for exactly ${input.count} questions (token ${input.requestSeed}).`,
        },
      ],
      input.userId,
      chatOpts
    ).catch(async () =>
      AiProviderService.chat(
        "TEACHING_ASSISTANT",
        [
          { role: "system", content: prompt },
          {
            role: "user",
            content: `Return ONLY valid complete JSON for exactly ${input.count} questions (token ${input.requestSeed}).`,
          },
        ],
        input.userId,
        chatOpts
      )
    );

    const parsed = parseQuizJson(result.text);

    const questions = (parsed.questions || [])
      .filter((q) => q.text && q.options && q.correctKey)
      .slice(0, input.count)
      .map((q) => ({
        text: String(q.text),
        options: q.options as Record<string, string>,
        correctKey: String(q.correctKey).toUpperCase(),
      }));

    return {
      title: parsed.title ? String(parsed.title) : null,
      questions,
    };
  }

  static async generateAndPublish(input: {
    actorId: string;
    educationalStageId: string;
    subjectId?: string | null;
    documentIds: string[];
    titleEn?: string;
    count?: number;
    language?: string | null;
    courseId?: string | null;
    lessonId?: string | null;
    publish?: boolean;
  }) {
    if (!input.documentIds.length) {
      throw new Error("Select at least one knowledge document");
    }

    const practice = await this.generatePractice({
      userId: input.actorId,
      question: "Generate an assessment quiz from these materials",
      language: input.language || "en",
      educationalStageId: input.educationalStageId,
      subjectIds: input.subjectId ? [input.subjectId] : undefined,
      documentIds: input.documentIds,
      count: input.count ?? 8,
      requireDocuments: true,
    });

    const questions: GeneratedQuestion[] = practice.questions.map((q) => ({
      type: "MULTIPLE_CHOICE" as const,
      textEn: q.text,
      textAr: q.text,
      textKu: q.text,
      textTr: q.text,
      options: q.options,
      correctKey: q.correctKey,
      points: 1,
    }));

    const title = input.titleEn || practice.title || "AI Generated Quiz";

    if (!input.publish) {
      return { preview: { title, questions, citations: practice.citations }, quiz: null, questions };
    }

    const quiz = await QuizService.createQuiz({
      type: input.lessonId ? "LESSON" : input.courseId ? "COURSE" : "SUBJECT_FINAL",
      titleEn: title,
      titleAr: title,
      titleKu: title,
      titleTr: title,
      subject: input.subjectId
        ? { connect: { id: input.subjectId } }
        : undefined,
      course: input.courseId ? { connect: { id: input.courseId } } : undefined,
      lesson: input.lessonId ? { connect: { id: input.lessonId } } : undefined,
      passPercentage: 50,
      maxAttempts: 3,
      randomize: true,
      isActive: true,
      questions: questions.map((q) => ({
        ...q,
        options: q.options as Prisma.InputJsonValue,
      })),
    });

    return { preview: null, quiz, citations: practice.citations, questions };
  }

  private static async loadMaterialText(input: {
    userId: string;
    question: string;
    educationalStageId?: string | null;
    subjectIds?: string[];
    documentIds?: string[];
    attachmentText?: string;
    allowRagFallback?: boolean;
    sampleSeed?: number;
    /** Restrict chunks to this chapter/section title (or "__all__"). */
    chapterHeading?: string | null;
    chunkFrom?: number | null;
    chunkTo?: number | null;
    pageFrom?: number | null;
    pageTo?: number | null;
  }) {
    const citations: Array<{ documentName: string; page: number | null }> = [];
    const parts: string[] = [];
    const seed = input.sampleSeed ?? Date.now();

    if (input.attachmentText?.trim()) {
      parts.push(input.attachmentText.trim());
      citations.push({ documentName: "attachment", page: null });
    }

    if (input.documentIds?.length) {
      const chunks = await prisma.kbChunk.findMany({
        where: {
          documentId: { in: input.documentIds },
          document: {
            status: "READY",
            deletedAt: null,
            instructorId: null,
            ...(input.educationalStageId
              ? { educationalStageId: input.educationalStageId }
              : {}),
            ...(input.subjectIds?.length
              ? { subjectId: { in: input.subjectIds } }
              : {}),
          },
        },
        take: 400,
        orderBy: { chunkIndex: "asc" },
        include: { document: { select: { fileName: true } } },
      });

      let scoped = chunks;
      const chapter = (input.chapterHeading || "").trim();
      if (chapter && chapter !== "__all__") {
        const pageMatch = chapter.match(/^Pages?\s+(\d+)\s*[–-]\s*(\d+)/i);
        if (pageMatch) {
          const from = Number(pageMatch[1]);
          const to = Number(pageMatch[2]);
          scoped = chunks.filter(
            (c) =>
              c.pageNumber != null &&
              c.pageNumber >= from &&
              c.pageNumber <= to
          );
        } else if (
          input.chunkFrom != null &&
          input.chunkTo != null &&
          input.chunkTo >= input.chunkFrom
        ) {
          scoped = chunks.filter(
            (c) =>
              c.chunkIndex >= input.chunkFrom! &&
              c.chunkIndex <= input.chunkTo!
          );
        } else {
          // Match heading: exact metadata.heading or text starting with heading
          const key = chapter.toLowerCase();
          const withHeading = chunks.filter((c) => {
            const meta = (c.metadata || {}) as Record<string, unknown>;
            const h =
              typeof meta.heading === "string"
                ? meta.heading.toLowerCase()
                : "";
            return (
              h === key ||
              c.text.toLowerCase().startsWith(key) ||
              c.text.toLowerCase().includes(`\n${key}`)
            );
          });
          if (withHeading.length) {
            // Expand to section range: from first matching heading to next different heading
            const startIdx = withHeading[0]!.chunkIndex;
            let endIdx = chunks.at(-1)?.chunkIndex ?? startIdx;
            for (const c of chunks) {
              if (c.chunkIndex <= startIdx) continue;
              const meta = (c.metadata || {}) as Record<string, unknown>;
              const h =
                typeof meta.heading === "string" ? meta.heading.trim() : "";
              if (h && h.toLowerCase() !== key) {
                endIdx = c.chunkIndex - 1;
                break;
              }
            }
            scoped = chunks.filter(
              (c) => c.chunkIndex >= startIdx && c.chunkIndex <= endIdx
            );
          }
        }
        if (!scoped.length) scoped = chunks;
      }

      // Prefer contiguous chapter body over random sample when chapter is set
      if (chapter && chapter !== "__all__" && scoped.length) {
        const ordered = scoped.slice(0, 80);
        for (const c of ordered) {
          parts.push(`[${c.document.fileName} · ${chapter}]\n${c.text}`);
          citations.push({
            documentName: c.document.fileName,
            page: c.pageNumber,
          });
        }
      } else {
        const byDoc = new Map<string, typeof scoped>();
        for (const c of scoped) {
          const list = byDoc.get(c.documentId) || [];
          list.push(c);
          byDoc.set(c.documentId, list);
        }

        const queues = [...byDoc.values()].map((list, idx) =>
          shuffleWithSeed(list, seed + idx * 97)
        );
        const picked: typeof scoped = [];
        const target = Math.min(48, scoped.length || 0);
        let guard = 0;
        while (
          picked.length < target &&
          queues.some((q) => q.length) &&
          guard < 500
        ) {
          guard += 1;
          const order = shuffleWithSeed(
            queues.map((_, i) => i).filter((i) => queues[i]!.length > 0),
            seed + guard
          );
          for (const i of order) {
            const next = queues[i]!.shift();
            if (next) picked.push(next);
            if (picked.length >= target) break;
          }
        }

        const ordered = shuffleWithSeed(picked, seed ^ 0x9e3779b9);
        for (const c of ordered) {
          parts.push(`[${c.document.fileName}]\n${c.text}`);
          citations.push({
            documentName: c.document.fileName,
            page: c.pageNumber,
          });
        }
      }
    } else if (input.allowRagFallback !== false) {
      const angleHint = FOCUS_ANGLES[seed % FOCUS_ANGLES.length];
      const embed = await EmbeddingService.embedText(
        [input.question || "quiz from materials", angleHint, `seed:${seed}`]
          .filter(Boolean)
          .join("\n"),
        input.userId
      );
      const hits = await VectorSearchService.search(embed, {
        educationalStageId: input.educationalStageId,
        subjectIds: input.subjectIds,
        subjectStrict: Boolean(input.subjectIds?.length),
        stageStrict: true,
        topK: 24,
        minSimilarity: 0.32,
      });
      const sampled = shuffleWithSeed(hits, seed).slice(0, 12);
      for (const h of sampled) {
        parts.push(`[${h.fileName}]\n${h.text}`);
        citations.push({ documentName: h.fileName, page: h.pageNumber });
      }
    }

    if (!parts.length) {
      throw new Error("No materials available to generate a quiz");
    }

    // Prefer unique document names for UI chips (not one chip per chunk).
    const seenCite = new Set<string>();
    const uniqueCitations = citations.filter((c) => {
      const key = c.documentName.toLowerCase().trim();
      if (!key || seenCite.has(key)) return false;
      seenCite.add(key);
      return true;
    });

    return { text: parts.join("\n\n---\n\n"), citations: uniqueCitations };
  }

  /** Public loader for chat explain/observe flows. */
  static async loadMaterialForDocuments(input: {
    userId: string;
    documentIds: string[];
    educationalStageId?: string | null;
    subjectIds?: string[];
    question?: string;
    chapterHeading?: string | null;
    chunkFrom?: number | null;
    chunkTo?: number | null;
  }) {
    return this.loadMaterialText({
      userId: input.userId,
      question: input.question || "explain selected material",
      educationalStageId: input.educationalStageId,
      subjectIds: input.subjectIds,
      documentIds: input.documentIds,
      chapterHeading: input.chapterHeading,
      chunkFrom: input.chunkFrom,
      chunkTo: input.chunkTo,
      allowRagFallback: false,
    });
  }
}
