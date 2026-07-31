"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { getLocalizedField } from "@/lib/utils";
import {
  CircularGauge,
  levelColor,
  trendArrow,
  trendColor,
  type LearningTrend,
  type PerformanceLevel,
} from "@/components/subjects/scorecard-ui";
import { useParams } from "next/navigation";

type SubjectScorecardEntry = {
  subjectId: string;
  subjectName: { nameEn: string; nameAr: string; nameKu: string; nameTr: string };
  subjectThumbnail: string | null;
  masteryScore: number;
  performanceLevel: PerformanceLevel;
  aiConfidenceScore: number;
  retentionScore: number;
  trend: LearningTrend;
  lastComputedAt: string;
};

export default function StudentSubjectsPage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const [subjects, setSubjects] = useState<SubjectScorecardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/subjects");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        if (!cancelled) setSubjects((data.subjects || []) as SubjectScorecardEntry[]);
      } catch {
        if (!cancelled) setError(t.subjects.loadError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t.subjects.loadError]);

  return (
    <div>
      <PageHeader title={t.subjects.title} description={t.subjects.description} />

      {error && (
        <Card className="mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300">{error}</Card>
      )}

      {!subjects && !error && (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="h-48 animate-pulse bg-white/5">
              {null}
            </Card>
          ))}
        </div>
      )}

      {subjects && subjects.length === 0 && (
        <Card className="border-dashed text-center text-muted">{t.subjects.empty}</Card>
      )}

      {subjects && subjects.length > 0 && (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((s) => {
            const name = getLocalizedField(s.subjectName, "name", locale) || s.subjectName.nameEn;
            return (
              <Link key={s.subjectId} href={`/${locale}/student/subjects/${s.subjectId}`}>
                <Card className="flex h-full flex-col gap-4 transition-colors hover:border-accent/40">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">{name}</h3>
                      <span
                        className={`mt-1 inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${levelColor(
                          s.performanceLevel
                        )}`}
                      >
                        {t.subjects.levels[s.performanceLevel]}
                      </span>
                    </div>
                    <CircularGauge percent={s.masteryScore} label={t.subjects.mastery} />
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-xl border border-card-border bg-white/5 px-3 py-2">
                      <p className="text-lg font-bold text-foreground">{s.aiConfidenceScore}%</p>
                      <p className="text-[11px] text-muted">{t.subjects.aiConfidence}</p>
                    </div>
                    <div className="rounded-xl border border-card-border bg-white/5 px-3 py-2">
                      <p className="text-lg font-bold text-foreground">{s.retentionScore}%</p>
                      <p className="text-[11px] text-muted">{t.subjects.retention}</p>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between text-xs">
                    <span className={`font-semibold ${trendColor(s.trend)}`}>
                      {trendArrow(s.trend)} {t.subjects.trends[s.trend]}
                    </span>
                    <span className="text-muted">
                      {t.subjects.lastUpdated.replace(
                        "{date}",
                        new Date(s.lastComputedAt).toLocaleDateString(
                          locale === "ar" ? "ar" : locale === "tr" ? "tr" : "en"
                        )
                      )}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
