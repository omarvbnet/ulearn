"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { getLocalizedField } from "@/lib/utils";
import {
  CircularGauge,
  ScoreBar,
  levelColor,
  trendArrow,
  trendColor,
  type LearningTrend,
  type PerformanceLevel,
} from "@/components/subjects/scorecard-ui";

type Scorecard = {
  subjectId: string;
  subjectName: { nameEn: string; nameAr: string; nameKu: string; nameTr: string };
  subjectThumbnail: string | null;
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
  trendHistory: { date: string; masteryScore: number }[];
  lastComputedAt: string;
};

/** Dimensions that are honest proxies/estimates from indirect signals, not
 *  direct measurements — shown with an "estimated" tag in the UI. */
const ESTIMATED_DIMENSIONS = new Set([
  "problemSolvingScore",
  "practicalSkillsScore",
  "learningSpeedScore",
  "participationScore",
  "consistencyScore",
  "improvementScore",
]);

export default function StudentSubjectDetailPage() {
  const t = useT();
  const { locale, subjectId } = useParams<{ locale: string; subjectId: string }>();
  const [scorecard, setScorecard] = useState<Scorecard | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const dateLocale = locale === "ar" ? "ar" : locale === "tr" ? "tr" : "en";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/student/subjects/${subjectId}`);
        const data = await res.json();
        if (res.status === 404) {
          if (!cancelled) setScorecard(null);
          return;
        }
        if (!res.ok) throw new Error(data.error || "Failed");
        if (!cancelled) setScorecard(data.scorecard as Scorecard);
      } catch {
        if (!cancelled) setError(t.subjects.loadError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectId, t.subjects.loadError]);

  const name = scorecard
    ? getLocalizedField(scorecard.subjectName, "name", locale) || scorecard.subjectName.nameEn
    : "";

  return (
    <div>
      <PageHeader
        title={name || t.subjects.title}
        description={t.subjects.description}
        actions={
          <Link href={`/${locale}/student/subjects`}>
            <Button variant="outline">{t.subjects.backToSubjects}</Button>
          </Link>
        }
      />

      {error && (
        <Card className="mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300">{error}</Card>
      )}

      {scorecard === undefined && !error && (
        <Card className="h-64 animate-pulse bg-white/5">{null}</Card>
      )}

      {scorecard === null && (
        <Card className="border-dashed text-center text-muted">{t.subjects.notFound}</Card>
      )}

      {scorecard && (
        <div className="space-y-6">
          <Card className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-6">
              <CircularGauge percent={scorecard.masteryScore} label={t.subjects.mastery} size={104} />
              <CircularGauge
                percent={scorecard.aiConfidenceScore}
                label={t.subjects.aiConfidence}
                size={104}
                colorClassName="stroke-sky-400"
              />
              <CircularGauge
                percent={scorecard.retentionScore}
                label={t.subjects.retention}
                size={104}
                colorClassName="stroke-emerald-400"
              />
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <span
                className={`rounded-full border px-3 py-1 text-sm font-bold ${levelColor(
                  scorecard.performanceLevel
                )}`}
              >
                {t.subjects.levels[scorecard.performanceLevel]}
              </span>
              <span className={`text-sm font-semibold ${trendColor(scorecard.trend)}`}>
                {trendArrow(scorecard.trend)} {t.subjects.trends[scorecard.trend]}
              </span>
              <span className="text-xs text-muted">
                {t.subjects.lastUpdated.replace(
                  "{date}",
                  new Date(scorecard.lastComputedAt).toLocaleDateString(dateLocale)
                )}
              </span>
            </div>
          </Card>

          {scorecard.trendHistory.length >= 2 && (
            <Card>
              <h2 className="mb-4 font-semibold text-foreground">{t.subjects.trendChart}</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={scorecard.trendHistory}>
                    <defs>
                      <linearGradient id="mastery" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a020f0" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#a020f0" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1a1a35" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: "#8b9bb4", fontSize: 11 }} />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: "#8b9bb4", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#0c0c1a",
                        border: "1px solid #1a1a35",
                        borderRadius: 8,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="masteryScore"
                      stroke="#00e5ff"
                      fill="url(#mastery)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <Card>
            <h2 className="mb-4 font-semibold text-foreground">{t.subjects.dimensionsTitle}</h2>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <ScoreBar
                label={t.subjects.dimensions.quizAccuracy}
                percent={scorecard.quizAccuracyScore}
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.problemSolving}
                percent={scorecard.problemSolvingScore}
                estimated={ESTIMATED_DIMENSIONS.has("problemSolvingScore")}
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.practicalSkills}
                percent={scorecard.practicalSkillsScore}
                estimated
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.criticalThinking}
                percent={scorecard.criticalThinkingScore}
                estimated
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.communication}
                percent={scorecard.communicationScore}
                estimated
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.creativity}
                percent={scorecard.creativityScore}
                estimated
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.learningSpeed}
                percent={scorecard.learningSpeedScore}
                estimated
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.participation}
                percent={scorecard.participationScore}
                estimated
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.attendance}
                percent={scorecard.attendanceScore}
                hint={t.subjects.activityBased}
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.consistency}
                percent={scorecard.consistencyScore}
                estimated
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.improvement}
                percent={scorecard.improvementScore}
                estimated
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
              <ScoreBar
                label={t.subjects.dimensions.homework}
                percent={scorecard.homeworkScore}
                notEnoughDataLabel={t.subjects.notEnoughData}
                estimatedLabel={t.subjects.estimated}
              />
            </div>
          </Card>

          <div className="flex justify-center">
            <Link href={`/${locale}/student/ai`}>
              <Button variant="outline">{t.subjects.practiceThisSubject}</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
