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
  /** Every curriculum lesson title the student has fully moved past for this
   *  material — the AI Teacher never re-teaches these on resume; it always
   *  continues from the next uncompleted lesson in the outline. */
  completedLessons?: string[];
};

export type MaterialEvaluationSummary = MaterialProgressEntry & {
  materialsKey: string;
  masteredCount?: number;
  weakCount?: number;
};

/** A concept is only "mastered" after repeated, consistent evidence — never
 *  after a single correct answer. A concept becomes "weak" after two wrong
 *  attempts in a row, even if it was mastered before (a real signal that it
 *  has weakened enough to deserve a brief review). */
export type ConceptMasteryStatus = "learning" | "weak" | "mastered";

export type ConceptMasteryEntry = {
  status: ConceptMasteryStatus;
  correctStreak: number;
  wrongStreak: number;
  totalCorrect: number;
  totalWrong: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

/** topic label -> mastery entry, scoped to one material (documentIds set). */
export type ConceptMasteryMap = Record<string, ConceptMasteryEntry>;

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
        completedLessons: prev?.completedLessons,
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
    const masteryAll =
      mem.conceptMastery && typeof mem.conceptMastery === "object"
        ? (mem.conceptMastery as Record<string, ConceptMasteryMap>)
        : {};
    return Object.entries(map)
      .map(([materialsKey, entry]) => {
        const concepts = masteryAll[materialsKey] || {};
        const statuses = Object.values(concepts).map((c) => c.status);
        return {
          materialsKey,
          ...entry,
          masteredCount: statuses.filter((s) => s === "mastered").length,
          weakCount: statuses.filter((s) => s === "weak").length,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
      );
  }

  /** Every curriculum-lesson-title -> per-concept mastery ledger for one
   *  material (documentIds set), used to skip re-teaching mastered lessons
   *  and to steer the prompt toward quiet reinforcement vs. review. */
  static async getConceptMastery(
    userId: string,
    materialsKey: string
  ): Promise<ConceptMasteryMap> {
    if (!materialsKey) return {};
    try {
      const mem = await this.getOrCreate(userId);
      const all =
        mem.conceptMastery && typeof mem.conceptMastery === "object"
          ? (mem.conceptMastery as Record<string, ConceptMasteryMap>)
          : {};
      return all[materialsKey] || {};
    } catch {
      return {};
    }
  }

  /** Fire-and-forget: record one piece of evidence (a resolved check
   *  question) toward whether a concept is mastered, still learning, or
   *  weak. Mastery requires a real streak of consistent correct answers —
   *  never assumed from a single explanation or a single correct answer. */
  static async recordConceptEvidence(
    userId: string,
    materialsKey: string,
    topic: string | null | undefined,
    correct: boolean
  ) {
    const key = (topic || "").trim().slice(0, 80);
    if (!materialsKey || !key) return;
    try {
      const mem = await this.getOrCreate(userId);
      const all = (
        mem.conceptMastery && typeof mem.conceptMastery === "object"
          ? { ...(mem.conceptMastery as Record<string, unknown>) }
          : {}
      ) as Record<string, ConceptMasteryMap>;
      const materialMap = { ...(all[materialsKey] || {}) };
      const prev = materialMap[key];
      const now = new Date().toISOString();
      const correctStreak = correct ? (prev?.correctStreak || 0) + 1 : 0;
      const wrongStreak = correct ? 0 : (prev?.wrongStreak || 0) + 1;
      const totalCorrect = (prev?.totalCorrect || 0) + (correct ? 1 : 0);
      const totalWrong = (prev?.totalWrong || 0) + (correct ? 0 : 1);
      const ratio = totalCorrect / Math.max(1, totalCorrect + totalWrong);

      let status: ConceptMasteryStatus = prev?.status || "learning";
      if (wrongStreak >= 2) {
        // Two wrong in a row is a real "weakened significantly" signal,
        // even if it was mastered before.
        status = "weak";
      } else if (correctStreak >= 2 && totalCorrect >= 3 && ratio >= 0.7) {
        status = "mastered";
      } else if (status === "weak" && correct) {
        status = "learning";
      }

      materialMap[key] = {
        status,
        correctStreak,
        wrongStreak,
        totalCorrect,
        totalWrong,
        firstSeenAt: prev?.firstSeenAt || now,
        lastSeenAt: now,
      };
      all[materialsKey] = materialMap;
      await prisma.studentAiMemory.update({
        where: { userId },
        data: { conceptMastery: all as unknown as Prisma.InputJsonValue },
      });
    } catch {
      /* ignore mastery writeback failures */
    }
  }

  /** Fire-and-forget: mark a curriculum lesson as fully completed for this
   *  material so future sessions never restart or re-teach it — the AI
   *  Teacher always resumes from the next uncompleted lesson in the
   *  outline instead of jumping randomly or repeating what was covered. */
  static async markLessonCompleted(
    userId: string,
    materialsKey: string,
    lessonName: string | null | undefined
  ) {
    const lesson = (lessonName || "").trim();
    if (!materialsKey || !lesson) return;
    try {
      const mem = await this.getOrCreate(userId);
      const map = (
        mem.materialProgress && typeof mem.materialProgress === "object"
          ? { ...(mem.materialProgress as Record<string, unknown>) }
          : {}
      ) as Record<string, MaterialProgressEntry>;
      const prev = map[materialsKey];
      const completed = [...(prev?.completedLessons || [])];
      if (!completed.includes(lesson)) completed.push(lesson);
      map[materialsKey] = {
        lessonName: prev?.lessonName || lesson,
        lessonIndex: prev?.lessonIndex ?? null,
        updatedAt: new Date().toISOString(),
        materialNames: prev?.materialNames,
        curriculumOutline: prev?.curriculumOutline,
        understanding: prev?.understanding,
        confidence: prev?.confidence,
        learningSpeed: prev?.learningSpeed,
        mistakes: prev?.mistakes,
        evaluation: prev?.evaluation,
        completedLessons: completed.slice(-60),
      };
      await prisma.studentAiMemory.update({
        where: { userId },
        data: { materialProgress: map as unknown as Prisma.InputJsonValue },
      });
    } catch {
      /* ignore progress writeback failures */
    }
  }

  /** Fire-and-forget: remember which language the student is usually
   *  taught in during live classroom sessions. */
  static async savePreferredLanguage(userId: string, language: string | null | undefined) {
    const lang = (language || "").trim().slice(0, 12);
    if (!lang) return;
    try {
      await prisma.studentAiMemory.update({
        where: { userId },
        data: { preferredLanguage: lang },
      });
    } catch {
      /* ignore */
    }
  }

  /** Compose the long-term "don't start from zero" memory block fed into
   *  the classroom prompt: what's already completed, what's mastered, what
   *  is weak, and the student's usual language/style/pace for this
   *  material specifically (on top of the generic cross-subject blurb from
   *  toPromptBlurb). */
  static classroomMemoryBlurb(input: {
    preferredLanguage?: string | null;
    preferredStyle?: string | null;
    learningSpeed?: string | null;
    completedLessons: string[];
    conceptMastery?: ConceptMasteryMap;
  }): string {
    const mastery = input.conceptMastery || {};
    const mastered = Object.entries(mastery)
      .filter(([, v]) => v.status === "mastered")
      .map(([topic]) => topic);
    const weak = Object.entries(mastery)
      .filter(([, v]) => v.status === "weak")
      .map(([topic]) => topic);

    const bits: string[] = [];
    if (input.completedLessons.length) {
      bits.push(
        `Already completed in THIS material, do NOT re-teach or restart: ${input.completedLessons
          .slice(-12)
          .join(", ")}`
      );
    }
    if (mastered.length) {
      bits.push(
        `Mastered concepts (build on these, reference briefly instead of re-explaining): ${mastered
          .slice(-10)
          .join(", ")}`
      );
    }
    if (weak.length) {
      bits.push(
        `Weak concepts (weakened significantly — a short, natural review is welcome if relevant): ${weak
          .slice(-8)
          .join(", ")}`
      );
    }
    if (input.preferredLanguage) bits.push(`Usually taught in: ${input.preferredLanguage}`);
    if (input.preferredStyle) bits.push(`Preferred teaching style: ${input.preferredStyle}`);
    if (input.learningSpeed) bits.push(`Usual learning pace: ${input.learningSpeed}`);
    return bits.join("; ");
  }
}
