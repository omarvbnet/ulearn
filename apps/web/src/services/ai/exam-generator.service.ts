import { prisma } from "@/lib/prisma";
import { AiProviderService } from "./ai-provider.service";
import { EmbeddingService } from "./embedding.service";
import { VectorSearchService } from "./vector-search.service";
import { QuizService } from "@/services/quiz.service";
import { languageInstruction } from "./types";
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

    return {
      title: `${baseTitle} · #${titleSuffix}`,
      questions: generated.questions,
      citations: material.citations,
    };
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
      "correctKey must be one of A|B|C|D. Every question must be answerable from the material.",
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
        take: 240,
        orderBy: { chunkIndex: "asc" },
        include: { document: { select: { fileName: true } } },
      });

      const byDoc = new Map<string, typeof chunks>();
      for (const c of chunks) {
        const list = byDoc.get(c.documentId) || [];
        list.push(c);
        byDoc.set(c.documentId, list);
      }

      const queues = [...byDoc.values()].map((list, idx) =>
        shuffleWithSeed(list, seed + idx * 97)
      );
      const picked: typeof chunks = [];
      const target = Math.min(48, chunks.length || 0);
      let guard = 0;
      while (picked.length < target && queues.some((q) => q.length) && guard < 500) {
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

    return { text: parts.join("\n\n---\n\n"), citations };
  }
}
