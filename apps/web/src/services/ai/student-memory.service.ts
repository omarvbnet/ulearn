import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type ExamResultEntry = {
  title: string;
  percentage: number;
  passed: boolean;
  documentIds?: string[];
  weakQuestionHints?: string[];
  at: string;
};

export type MaterialEvaluation = {
  /** Overall mastery 0-100, derived from the live classroom understanding score. */
  scorePercent: number;
  /** Short teacher-written paragraph summarizing performance on this material. */
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  lessonsCompleted: number;
  totalLessons: number;
  generatedAt: string;
};

export type MaterialProgressEntry = {
  lessonName: string;
  lessonIndex: number | null;
  updatedAt: string;
  materialNames?: string[];
  curriculumOutline?: string[];
  understanding?: number;
  confidence?: number;
  learningSpeed?: string;
  mistakes?: string[];
  evaluation?: MaterialEvaluation | null;
};

export type MaterialEvaluationSummary = MaterialProgressEntry & {
  materialsKey: string;
};

export class StudentMemoryService {
  static async getOrCreate(userId: string) {
    const existing = await prisma.studentAiMemory.findUnique({ where: { userId } });
    if (existing) return existing;
    return prisma.studentAiMemory.create({ data: { userId } });
  }

  static toPromptBlurb(memory: {
    weakSubjects: string[];
    strongSubjects: string[];
    preferredStyle: string | null;
    learningSpeed: string | null;
    examResults?: unknown;
  }) {
    const bits: string[] = [];
    if (memory.weakSubjects.length) bits.push(`weaker topics: ${memory.weakSubjects.slice(0, 5).join(", ")}`);
    if (memory.strongSubjects.length)
      bits.push(`stronger topics: ${memory.strongSubjects.slice(0, 5).join(", ")}`);
    if (memory.preferredStyle) bits.push(`style: ${memory.preferredStyle}`);
    if (memory.learningSpeed) bits.push(`pace: ${memory.learningSpeed}`);

    const exams = Array.isArray(memory.examResults)
      ? (memory.examResults as ExamResultEntry[])
      : [];
    if (exams.length) {
      const recent = exams.slice(0, 5);
      const passed = recent.filter((e) => e.passed).length;
      const failed = recent.length - passed;
      const avg =
        Math.round(
          (recent.reduce((s, e) => s + (e.percentage || 0), 0) / recent.length) * 10
        ) / 10;
      bits.push(
        `AI practice exams (recent ${recent.length}): ${passed} passed, ${failed} failed, avg ${avg}%`
      );
      const last = recent[0];
      if (last) {
        bits.push(
          `latest AI exam "${last.title}": ${last.percentage}% (${last.passed ? "passed" : "failed"})`
        );
      }
      const weakHints = recent
        .flatMap((e) => e.weakQuestionHints || [])
        .slice(0, 4);
      if (weakHints.length) bits.push(`recent missed concepts: ${weakHints.join("; ")}`);
    }
    return bits.join("; ");
  }

  static async recordQuestion(userId: string, question: string, subjectId?: string | null) {
    const mem = await this.getOrCreate(userId);
    const faq = (Array.isArray(mem.frequentQuestions) ? mem.frequentQuestions : []) as {
      q: string;
      count: number;
    }[];
    const key = question.slice(0, 120).toLowerCase();
    const found = faq.find((f) => f.q === key);
    if (found) found.count += 1;
    else faq.unshift({ q: key, count: 1 });
    const trimmed = faq.slice(0, 40);

    const weak = [...mem.weakSubjects];
    if (subjectId && !weak.includes(subjectId) && weak.length < 20) weak.push(subjectId);

    await prisma.studentAiMemory.update({
      where: { userId },
      data: {
        frequentQuestions: trimmed as Prisma.InputJsonValue,
        weakSubjects: weak,
      },
    });
  }

  static async recordExamResult(
    userId: string,
    result: {
      title: string;
      percentage: number;
      passed: boolean;
      documentIds?: string[];
      weakQuestionHints?: string[];
    }
  ) {
    const mem = await this.getOrCreate(userId);
    const prev = (Array.isArray(mem.examResults) ? mem.examResults : []) as ExamResultEntry[];
    const entry: ExamResultEntry = {
      title: result.title,
      percentage: result.percentage,
      passed: result.passed,
      documentIds: result.documentIds,
      weakQuestionHints: (result.weakQuestionHints || []).slice(0, 6),
      at: new Date().toISOString(),
    };
    const next = [entry, ...prev].slice(0, 40);

    const strong = [...mem.strongSubjects];
    const weak = [...mem.weakSubjects];
    const tag = result.title.slice(0, 60);
    if (result.passed) {
      if (!strong.includes(tag) && strong.length < 20) strong.push(tag);
      const wi = weak.indexOf(tag);
      if (wi >= 0) weak.splice(wi, 1);
    } else {
      if (!weak.includes(tag) && weak.length < 20) weak.push(tag);
    }

    await prisma.studentAiMemory.update({
      where: { userId },
      data: {
        examResults: next as unknown as Prisma.InputJsonValue,
        strongSubjects: strong,
        weakSubjects: weak,
      },
    });
  }

  /** Stable key for a set of KB documents, order-independent. */
  static materialsKey(documentIds: string[] | null | undefined): string {
    return [...(documentIds || [])]
      .filter(Boolean)
      .sort()
      .join(",");
  }

  static async getMaterialProgress(
    userId: string,
    materialsKey: string
  ): Promise<MaterialProgressEntry | null> {
    if (!materialsKey) return null;
    try {
      const mem = await this.getOrCreate(userId);
      const map =
        mem.materialProgress && typeof mem.materialProgress === "object"
          ? (mem.materialProgress as Record<string, MaterialProgressEntry>)
          : {};
      return map[materialsKey] || null;
    } catch {
      return null;
    }
  }

  /** Fire-and-forget: remembers the student's furthest lesson per material set. */
  static async saveMaterialProgress(
    userId: string,
    materialsKey: string,
    progress: {
      lessonName?: string | null;
      lessonIndex?: number | null;
      materialNames?: string[];
      curriculumOutline?: string[];
      understanding?: number;
      confidence?: number;
      learningSpeed?: string;
      mistakes?: string[];
    }
  ) {
    if (!materialsKey || !progress.lessonName) return;
    try {
      const mem = await this.getOrCreate(userId);
      const map = (
        mem.materialProgress && typeof mem.materialProgress === "object"
          ? { ...(mem.materialProgress as Record<string, unknown>) }
          : {}
      ) as Record<string, MaterialProgressEntry>;
      const prev = map[materialsKey];
      map[materialsKey] = {
        ...prev,
        lessonName: progress.lessonName,
        lessonIndex: progress.lessonIndex ?? null,
        updatedAt: new Date().toISOString(),
        materialNames: progress.materialNames?.length
          ? progress.materialNames
          : prev?.materialNames,
        curriculumOutline: progress.curriculumOutline?.length
          ? progress.curriculumOutline
          : prev?.curriculumOutline,
        understanding:
          typeof progress.understanding === "number"
            ? progress.understanding
            : prev?.understanding,
        confidence:
          typeof progress.confidence === "number"
            ? progress.confidence
            : prev?.confidence,
        learningSpeed: progress.learningSpeed || prev?.learningSpeed,
        mistakes: progress.mistakes?.length ? progress.mistakes.slice(-8) : prev?.mistakes,
      };
      await prisma.studentAiMemory.update({
        where: { userId },
        data: { materialProgress: map as unknown as Prisma.InputJsonValue },
      });
    } catch {
      /* ignore progress writeback failures */
    }
  }

  /** Persist (or refresh) the AI teacher's written evaluation for a material. */
  static async saveMaterialEvaluation(
    userId: string,
    materialsKey: string,
    evaluation: MaterialEvaluation
  ) {
    if (!materialsKey) return;
    try {
      const mem = await this.getOrCreate(userId);
      const map = (
        mem.materialProgress && typeof mem.materialProgress === "object"
          ? { ...(mem.materialProgress as Record<string, unknown>) }
          : {}
      ) as Record<string, MaterialProgressEntry>;
      const prev = map[materialsKey];
      map[materialsKey] = {
        lessonName: prev?.lessonName || "",
        lessonIndex: prev?.lessonIndex ?? null,
        updatedAt: new Date().toISOString(),
        materialNames: prev?.materialNames,
        curriculumOutline: prev?.curriculumOutline,
        understanding: prev?.understanding,
        confidence: prev?.confidence,
        learningSpeed: prev?.learningSpeed,
        mistakes: prev?.mistakes,
        evaluation,
      };
      await prisma.studentAiMemory.update({
        where: { userId },
        data: { materialProgress: map as unknown as Prisma.InputJsonValue },
      });
    } catch {
      /* ignore evaluation writeback failures */
    }
  }

  /** All per-material progress/evaluation entries for a student, newest first. */
  static async listMaterialEvaluations(
    userId: string
  ): Promise<MaterialEvaluationSummary[]> {
    const mem = await this.getOrCreate(userId);
    const map =
      mem.materialProgress && typeof mem.materialProgress === "object"
        ? (mem.materialProgress as Record<string, MaterialProgressEntry>)
        : {};
    return Object.entries(map)
      .map(([materialsKey, entry]) => ({ materialsKey, ...entry }))
      .sort(
        (a, b) =>
          new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
      );
  }
}
