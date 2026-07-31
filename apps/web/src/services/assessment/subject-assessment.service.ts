import { prisma } from "@/lib/prisma";
import type { LearningTrend, PerformanceLevel, Prisma } from "@prisma/client";
import {
  StudentMemoryService,
  type ConceptMasteryMap,
  type MaterialProgressEntry,
} from "../ai/student-memory.service";

/** One point in the trend chart — at most one snapshot per calendar day. */
export type TrendPoint = { date: string; masteryScore: number };

export type SubjectScorecard = {
  subjectId: string;
  masteryScore: number;
  performanceLevel: PerformanceLevel;
  aiConfidenceScore: number;
  retentionScore: number;
  problemSolvingScore: number | null;
  practicalSkillsScore: number | null;
  criticalThinkingScore: number | null;
  communicationScore: number | null;
  creativityScore: number | null;
  learningSpeedScore: number | null;
  participationScore: number | null;
  homeworkScore: number | null;
  quizAccuracyScore: number | null;
  attendanceScore: number | null;
  consistencyScore: number | null;
  improvementScore: number | null;
  trend: LearningTrend;
  trendHistory: TrendPoint[];
  lastComputedAt: string;
};

export type SubjectScorecardWithSubject = SubjectScorecard & {
  subjectName: { nameEn: string; nameAr: string; nameKu: string; nameTr: string };
  subjectThumbnail: string | null;
};

/** Never recompute the same subject twice within this window from the live
 *  classroom's hot path — quiz/exam grading always recomputes immediately
 *  regardless, since those are rare, explicit events. */
const RECOMPUTE_THROTTLE_MS = 2 * 60 * 1000;
/** Trailing window used for Attendance/Consistency "how regularly has the
 *  student been active on this subject" proxies. */
const ACTIVITY_WINDOW_DAYS = 30;

function clamp0100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function performanceLevelFor(score: number): PerformanceLevel {
  if (score <= 20) return "BEGINNER";
  if (score <= 40) return "BASIC";
  if (score <= 60) return "DEVELOPING";
  if (score <= 80) return "INTERMEDIATE";
  if (score <= 90) return "ADVANCED";
  return "EXPERT";
}

/** Wilson score lower bound (95% CI) — a real statistical "how sure are we"
 *  number. Needs BOTH a high success rate AND enough samples to score
 *  high, so a single lucky correct answer never reads as "97% confident"
 *  the way a naive average would. This is exactly what "AI Confidence"
 *  should mean. */
function wilsonLowerBound(successes: number, total: number): number {
  if (total <= 0) return 0;
  const z = 1.96;
  const p = Math.max(0, Math.min(1, successes / total));
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return Math.max(0, (centre - margin) / denom);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Coefficient-of-variation based regularity: 0% variation in the gaps
 *  between active days scores 100, wildly uneven gaps score low. */
function regularityScore(activeDayKeys: string[]): number | null {
  const days = [...new Set(activeDayKeys)].sort();
  if (days.length < 3) return null;
  const times = days.map((d) => new Date(d + "T00:00:00Z").getTime());
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push((times[i]! - times[i - 1]!) / 86400000);
  }
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (mean <= 0) return 100;
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean;
  return clamp0100(100 - cv * 100);
}

export class SubjectAssessmentService {
  /** Best-effort subject for a set of AI-classroom/exam document ids — the
   *  bridge between the AI Teacher track (keyed by documentIds) and the
   *  curriculum Subject taxonomy. KbDocument.subjectId is set by
   *  admins/teachers at upload time, never by students, so it is a
   *  trustworthy join key for the documents students actually pick from.
   *  Returns null (never a fabricated "General" subject) when nothing is
   *  tagged. */
  static async resolveSubjectForDocuments(
    documentIds: string[] | null | undefined
  ): Promise<string | null> {
    const ids = (documentIds || []).filter(Boolean);
    if (!ids.length) return null;
    const docs = await prisma.kbDocument.findMany({
      where: { id: { in: ids } },
      select: { subjectId: true },
    });
    const counts = new Map<string, number>();
    for (const d of docs) {
      if (!d.subjectId) continue;
      counts.set(d.subjectId, (counts.get(d.subjectId) || 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    }
    return best;
  }

  /** Resolves the Subject for a curriculum Quiz — it may be tagged
   *  directly, or only reachable via its chapter/lesson/course. */
  static async resolveSubjectForQuiz(quizId: string): Promise<string | null> {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        subjectId: true,
        chapter: { select: { subjectId: true } },
        lesson: { select: { chapter: { select: { subjectId: true } } } },
        course: { select: { subjectId: true } },
      },
    });
    if (!quiz) return null;
    return (
      quiz.subjectId ||
      quiz.chapter?.subjectId ||
      quiz.lesson?.chapter.subjectId ||
      quiz.course?.subjectId ||
      null
    );
  }

  /** Fire-and-forget recompute after a QuizAttempt is graded. */
  static async recomputeFromQuiz(userId: string, quizId: string): Promise<void> {
    const subjectId = await this.resolveSubjectForQuiz(quizId);
    if (!subjectId) return;
    await this.recompute(userId, subjectId);
  }

  static async recomputeFromDocuments(
    userId: string,
    documentIds: string[] | null | undefined
  ): Promise<void> {
    const subjectId = await this.resolveSubjectForDocuments(documentIds);
    if (!subjectId) return;
    await this.recompute(userId, subjectId);
  }

  /** Same as recomputeFromDocuments but skips the work entirely if this
   *  subject was already recomputed within RECOMPUTE_THROTTLE_MS — safe to
   *  call from the live classroom's per-beat hot path without adding
   *  noticeable latency. */
  static async recomputeFromDocumentsThrottled(
    userId: string,
    documentIds: string[] | null | undefined
  ): Promise<void> {
    const subjectId = await this.resolveSubjectForDocuments(documentIds);
    if (!subjectId) return;
    try {
      const existing = await prisma.subjectAssessment.findUnique({
        where: { userId_subjectId: { userId, subjectId } },
        select: { lastComputedAt: true },
      });
      if (
        existing &&
        Date.now() - existing.lastComputedAt.getTime() < RECOMPUTE_THROTTLE_MS
      ) {
        return;
      }
    } catch {
      /* fall through and recompute anyway */
    }
    await this.recompute(userId, subjectId);
  }

  /** Recomputes and persists the full scorecard for one (userId, subjectId)
   *  pair from every existing signal source. Best-effort: scoring must
   *  never block or fail the caller's actual flow (quiz grading, exam
   *  grading, live classroom beats). */
  static async recompute(userId: string, subjectId: string): Promise<void> {
    try {
      const [subjectDocs, quizAttempts, memory, courseProgress, videoProgress] =
        await Promise.all([
          prisma.kbDocument.findMany({
            where: { subjectId, deletedAt: null },
            select: { id: true },
          }),
          prisma.quizAttempt.findMany({
            where: {
              userId,
              quiz: {
                OR: [
                  { subjectId },
                  { chapter: { subjectId } },
                  { lesson: { chapter: { subjectId } } },
                  { course: { subjectId } },
                ],
              },
            },
            select: { percentage: true, passed: true, completedAt: true, startedAt: true },
            orderBy: { startedAt: "asc" },
          }),
          StudentMemoryService.getOrCreate(userId),
          prisma.courseLessonProgress.findMany({
            where: { userId, lesson: { course: { subjectId } } },
            select: { completionPct: true, isCompleted: true, lastWatchedAt: true },
          }),
          prisma.videoProgress.findMany({
            where: { userId, lesson: { chapter: { subjectId } } },
            select: { completionPct: true, isCompleted: true, lastWatchedAt: true },
          }),
        ]);

      const subjectDocIds = subjectDocs.map((d) => d.id);
      const subjectDocIdSet = new Set(subjectDocIds);

      const [aiExamAttempts, classroomSessions] = subjectDocIds.length
        ? await Promise.all([
            prisma.aiExamAttempt.findMany({
              where: { userId, documentIds: { hasSome: subjectDocIds }, percentage: { not: null } },
              select: { percentage: true, passed: true, completedAt: true, createdAt: true },
            }),
            prisma.aiClassroomSession.findMany({
              where: { userId, documentIds: { hasSome: subjectDocIds } },
              select: { documentIds: true, beatIndex: true, createdAt: true, updatedAt: true },
            }),
          ])
        : [[], []];

      // Long-term AI Teacher ledger entries (materialProgress/conceptMastery
      // are keyed by "materialsKey" = sorted documentIds joined by ",") that
      // touch at least one document tagged with this subject.
      const materialProgressMap =
        memory.materialProgress && typeof memory.materialProgress === "object"
          ? (memory.materialProgress as Record<string, MaterialProgressEntry>)
          : {};
      const conceptMasteryAll =
        memory.conceptMastery && typeof memory.conceptMastery === "object"
          ? (memory.conceptMastery as Record<string, ConceptMasteryMap>)
          : {};
      const relevantMaterialsKeys = new Set(
        [...Object.keys(materialProgressMap), ...Object.keys(conceptMasteryAll)].filter((key) =>
          key.split(",").some((id) => subjectDocIdSet.has(id))
        )
      );

      let masteredCount = 0;
      let weakCount = 0;
      let learningCount = 0;
      let conceptTotalCorrect = 0;
      let conceptTotalWrong = 0;
      const masteredAttemptCounts: number[] = [];
      for (const key of relevantMaterialsKeys) {
        const concepts = conceptMasteryAll[key] || {};
        for (const entry of Object.values(concepts)) {
          conceptTotalCorrect += entry.totalCorrect;
          conceptTotalWrong += entry.totalWrong;
          if (entry.status === "mastered") {
            masteredCount++;
            masteredAttemptCounts.push(entry.totalCorrect + entry.totalWrong);
          } else if (entry.status === "weak") {
            weakCount++;
          } else {
            learningCount++;
          }
        }
      }
      const totalConcepts = masteredCount + weakCount + learningCount;

      // ---- Mastery: blend AI Teacher concept mastery, quiz/exam accuracy,
      // and store-course completion, weighted by how much signal each has.
      const quizPercents = quizAttempts.map((a) => a.percentage);
      const examPercents = aiExamAttempts
        .map((a) => a.percentage)
        .filter((p): p is number => typeof p === "number");
      const courseCompletionPercents = [
        ...courseProgress.map((p) => p.completionPct),
        ...videoProgress.map((p) => p.completionPct),
      ];

      const weighted: { value: number; weight: number }[] = [];
      if (totalConcepts > 0) {
        weighted.push({ value: (masteredCount / totalConcepts) * 100, weight: totalConcepts });
      }
      if (quizPercents.length || examPercents.length) {
        const combined = [...quizPercents, ...examPercents];
        const avg = combined.reduce((s, p) => s + p, 0) / combined.length;
        weighted.push({ value: avg, weight: combined.length });
      }
      if (courseCompletionPercents.length) {
        const avg =
          courseCompletionPercents.reduce((s, p) => s + p, 0) / courseCompletionPercents.length;
        weighted.push({ value: avg, weight: courseCompletionPercents.length * 0.5 });
      }
      const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
      const masteryScore = clamp0100(
        totalWeight > 0
          ? weighted.reduce((s, w) => s + w.value * w.weight, 0) / totalWeight
          : 0
      );

      // ---- AI Confidence: Wilson lower bound over ALL pooled evidence.
      const successes =
        conceptTotalCorrect +
        quizPercents.reduce((s, p) => s + p / 100, 0) +
        examPercents.reduce((s, p) => s + p / 100, 0);
      const totalEvidence = conceptTotalCorrect + conceptTotalWrong + quizPercents.length + examPercents.length;
      const aiConfidenceScore = clamp0100(wilsonLowerBound(successes, totalEvidence) * 100);

      // ---- Retention: of concepts that reached enough evidence to be
      // judged mastered-or-weak, how many stayed mastered rather than
      // weakening back down.
      const judgedConcepts = masteredCount + weakCount;
      const retentionScore = judgedConcepts > 0 ? clamp0100((masteredCount / judgedConcepts) * 100) : 50;

      // ---- Problem Solving: quiz accuracy weighted toward harder tiers
      // (CHAPTER/SUBJECT_FINAL/COURSE quizzes over single-LESSON quizzes),
      // blended with the concept-mastery ratio — the closest honest signal
      // to "solves problems, not just recalls facts" available today.
      let problemSolvingScore: number | null = null;
      if (quizPercents.length || totalConcepts > 0) {
        const parts: { value: number; weight: number }[] = [];
        if (quizPercents.length) {
          const avg = quizPercents.reduce((s, p) => s + p, 0) / quizPercents.length;
          parts.push({ value: avg, weight: quizPercents.length });
        }
        if (totalConcepts > 0) {
          parts.push({ value: (masteredCount / totalConcepts) * 100, weight: totalConcepts * 0.5 });
        }
        const w = parts.reduce((s, p) => s + p.weight, 0);
        problemSolvingScore = clamp0100(parts.reduce((s, p) => s + p.value * p.weight, 0) / w);
      }

      // ---- Practical Skills: AI-classroom "hands-on" engagement volume
      // (sessions + beats taught). Explicitly labeled as an estimate in the
      // UI — this is engagement, not a direct skills assessment.
      const totalBeats = classroomSessions.reduce((s, c) => s + (c.beatIndex || 0), 0);
      const practicalSkillsScore = classroomSessions.length
        ? clamp0100((classroomSessions.length * 15 + totalBeats * 2))
        : null;

      // ---- Critical Thinking / Communication / Creativity: no reliable
      // per-subject long-term signal exists yet (teachingStrategy history
      // and student questions are only kept ephemerally on the live
      // session, not persisted per-subject) — honestly reported as "not
      // enough data" rather than reusing an unrelated proxy.
      const criticalThinkingScore: number | null = null;
      const communicationScore: number | null = null;
      const creativityScore: number | null = null;

      // ---- Learning Speed: prefer a per-subject signal (fewer attempts to
      // reach mastery = faster) over the global StudentAiMemory.learningSpeed.
      let learningSpeedScore: number | null = null;
      if (masteredAttemptCounts.length) {
        const avgAttempts =
          masteredAttemptCounts.reduce((s, n) => s + n, 0) / masteredAttemptCounts.length;
        // 3 attempts-to-mastery -> 100, 10+ -> 30, linear between.
        learningSpeedScore = clamp0100(100 - ((avgAttempts - 3) / 7) * 70);
      } else if (memory.learningSpeed) {
        learningSpeedScore =
          memory.learningSpeed === "fast" ? 85 : memory.learningSpeed === "slow" ? 35 : 60;
      }

      // ---- Participation: normalized interaction volume.
      const participationRaw =
        quizAttempts.length * 8 + aiExamAttempts.length * 8 + classroomSessions.length * 10 + totalBeats * 1.5;
      const participationScore =
        quizAttempts.length || aiExamAttempts.length || classroomSessions.length
          ? clamp0100(participationRaw)
          : null;

      // ---- Quiz Accuracy: straight average across quizzes + AI exams.
      const accuracyPercents = [...quizPercents, ...examPercents];
      const quizAccuracyScore = accuracyPercents.length
        ? clamp0100(accuracyPercents.reduce((s, p) => s + p, 0) / accuracyPercents.length)
        : null;

      // ---- Attendance & Consistency: activity-day based, explicitly
      // labeled in the UI as session-activity proxies, not physical
      // attendance.
      const activityDates: Date[] = [
        ...quizAttempts.map((a) => a.completedAt || a.startedAt),
        ...aiExamAttempts.map((a) => a.completedAt || a.createdAt),
        ...classroomSessions.map((c) => c.updatedAt || c.createdAt),
        ...courseProgress.map((p) => p.lastWatchedAt),
        ...videoProgress.map((p) => p.lastWatchedAt),
      ].filter((d): d is Date => Boolean(d));
      const activeDayKeys = activityDates.map((d) => dayKey(d));
      const distinctActiveDays = new Set(activeDayKeys);
      let attendanceScore: number | null = null;
      if (distinctActiveDays.size > 0) {
        const earliest = new Date(Math.min(...activityDates.map((d) => d.getTime())));
        const daysSinceFirst = Math.max(
          1,
          Math.round((Date.now() - earliest.getTime()) / 86400000)
        );
        const expectedDays = Math.min(daysSinceFirst, ACTIVITY_WINDOW_DAYS);
        attendanceScore = clamp0100((distinctActiveDays.size / expectedDays) * 100);
      }
      const consistencyScore = regularityScore([...distinctActiveDays]);

      // ---- Trend history + Improvement + Trend classification.
      const existingRow = await prisma.subjectAssessment.findUnique({
        where: { userId_subjectId: { userId, subjectId } },
        select: { trendHistory: true },
      });
      const prevHistory: TrendPoint[] = Array.isArray(existingRow?.trendHistory)
        ? (existingRow!.trendHistory as unknown as TrendPoint[])
        : [];
      const today = dayKey(new Date());
      const history = [...prevHistory];
      const last = history[history.length - 1];
      if (last && last.date === today) {
        last.masteryScore = masteryScore;
      } else {
        history.push({ date: today, masteryScore });
      }
      const cappedHistory = history.slice(-120);

      let improvementScore: number | null = null;
      let trend: LearningTrend = "STABLE";
      if (cappedHistory.length >= 4) {
        const windowSize = Math.min(7, Math.floor(cappedHistory.length / 2));
        const recentWindow = cappedHistory.slice(-windowSize);
        const priorWindow = cappedHistory.slice(-windowSize * 2, -windowSize);
        const avg = (arr: TrendPoint[]) =>
          arr.reduce((s, p) => s + p.masteryScore, 0) / Math.max(1, arr.length);
        const delta = avg(recentWindow) - avg(priorWindow || recentWindow);
        improvementScore = clamp0100(50 + delta);
        trend =
          delta >= 15
            ? "RAPID_IMPROVEMENT"
            : delta >= 5
              ? "STEADY_IMPROVEMENT"
              : delta > -5
                ? "STABLE"
                : delta > -15
                  ? "SLIGHT_DECLINE"
                  : "CRITICAL_DECLINE";
      }

      const performanceLevel = performanceLevelFor(masteryScore);

      await prisma.subjectAssessment.upsert({
        where: { userId_subjectId: { userId, subjectId } },
        create: {
          userId,
          subjectId,
          masteryScore,
          performanceLevel,
          aiConfidenceScore,
          retentionScore,
          problemSolvingScore,
          practicalSkillsScore,
          criticalThinkingScore,
          communicationScore,
          creativityScore,
          learningSpeedScore,
          participationScore,
          homeworkScore: null,
          quizAccuracyScore,
          attendanceScore,
          consistencyScore,
          improvementScore,
          trend,
          trendHistory: cappedHistory as unknown as Prisma.InputJsonValue,
        },
        update: {
          masteryScore,
          performanceLevel,
          aiConfidenceScore,
          retentionScore,
          problemSolvingScore,
          practicalSkillsScore,
          criticalThinkingScore,
          communicationScore,
          creativityScore,
          learningSpeedScore,
          participationScore,
          quizAccuracyScore,
          attendanceScore,
          consistencyScore,
          improvementScore,
          trend,
          trendHistory: cappedHistory as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      /* scoring is always best-effort — never break the caller's real flow */
    }
  }

  private static toScorecard(row: {
    subjectId: string;
    masteryScore: number;
    performanceLevel: PerformanceLevel;
    aiConfidenceScore: number;
    retentionScore: number;
    problemSolvingScore: number | null;
    practicalSkillsScore: number | null;
    criticalThinkingScore: number | null;
    communicationScore: number | null;
    creativityScore: number | null;
    learningSpeedScore: number | null;
    participationScore: number | null;
    homeworkScore: number | null;
    quizAccuracyScore: number | null;
    attendanceScore: number | null;
    consistencyScore: number | null;
    improvementScore: number | null;
    trend: LearningTrend;
    trendHistory: unknown;
    lastComputedAt: Date;
  }): SubjectScorecard {
    return {
      subjectId: row.subjectId,
      masteryScore: row.masteryScore,
      performanceLevel: row.performanceLevel,
      aiConfidenceScore: row.aiConfidenceScore,
      retentionScore: row.retentionScore,
      problemSolvingScore: row.problemSolvingScore,
      practicalSkillsScore: row.practicalSkillsScore,
      criticalThinkingScore: row.criticalThinkingScore,
      communicationScore: row.communicationScore,
      creativityScore: row.creativityScore,
      learningSpeedScore: row.learningSpeedScore,
      participationScore: row.participationScore,
      homeworkScore: row.homeworkScore,
      quizAccuracyScore: row.quizAccuracyScore,
      attendanceScore: row.attendanceScore,
      consistencyScore: row.consistencyScore,
      improvementScore: row.improvementScore,
      trend: row.trend,
      trendHistory: Array.isArray(row.trendHistory) ? (row.trendHistory as TrendPoint[]) : [],
      lastComputedAt: row.lastComputedAt.toISOString(),
    };
  }

  static async getScorecard(
    userId: string,
    subjectId: string
  ): Promise<SubjectScorecardWithSubject | null> {
    const row = await prisma.subjectAssessment.findUnique({
      where: { userId_subjectId: { userId, subjectId } },
      include: { subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true, thumbnail: true } } },
    });
    if (!row) return null;
    const { nameEn, nameAr, nameKu, nameTr, thumbnail } = row.subject;
    return {
      ...this.toScorecard(row),
      subjectName: { nameEn, nameAr, nameKu, nameTr },
      subjectThumbnail: thumbnail,
    };
  }

  /** Every subject the student has any recorded activity/scorecard for,
   *  highest mastery first. */
  static async listScorecardsForUser(userId: string): Promise<SubjectScorecardWithSubject[]> {
    const rows = await prisma.subjectAssessment.findMany({
      where: { userId },
      include: { subject: { select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true, thumbnail: true } } },
      orderBy: { masteryScore: "desc" },
    });
    return rows.map((row) => {
      const { nameEn, nameAr, nameKu, nameTr, thumbnail } = row.subject;
      return {
        ...this.toScorecard(row),
        subjectName: { nameEn, nameAr, nameKu, nameTr },
        subjectThumbnail: thumbnail,
      };
    });
  }
}
