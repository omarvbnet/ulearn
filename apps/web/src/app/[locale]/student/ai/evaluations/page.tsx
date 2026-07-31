"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

type EvaluationDetail = {
  scorePercent: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  lessonsCompleted: number;
  totalLessons: number;
  generatedAt: string;
};

type EvaluationEntry = {
  materialsKey: string;
  materialNames: string[];
  lessonName: string | null;
  lessonIndex: number | null;
  totalLessons: number;
  understanding: number | null;
  confidence: number | null;
  updatedAt: string;
  evaluation: EvaluationDetail | null;
};

function gradeFor(scorePercent: number): "excellent" | "good" | "fair" | "needsWork" {
  if (scorePercent >= 85) return "excellent";
  if (scorePercent >= 70) return "good";
  if (scorePercent >= 50) return "fair";
  return "needsWork";
}

function gradeColor(grade: ReturnType<typeof gradeFor>) {
  switch (grade) {
    case "excellent":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "good":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    case "fair":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    default:
      return "border-red-500/40 bg-red-500/10 text-red-300";
  }
}

export default function StudentEvaluationsPage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const router = useRouter();
  const [entries, setEntries] = useState<EvaluationEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dateLocale = locale === "ar" ? "ar" : locale === "tr" ? "tr" : "en";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai/classroom/evaluations");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        if (!cancelled) setEntries((data.evaluations || []) as EvaluationEntry[]);
      } catch {
        if (!cancelled) setError(t.evaluations.loadError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t.evaluations.loadError]);

  function continueMaterial(entry: EvaluationEntry) {
    const docs = entry.materialsKey.split(",").filter(Boolean);
    if (!docs.length) return;
    const params = new URLSearchParams();
    params.set("docs", docs.join(","));
    router.push(`/${locale}/student/ai/classroom?${params.toString()}`);
  }

  return (
    <div>
      <PageHeader title={t.evaluations.title} description={t.evaluations.description} />

      {error && (
        <Card className="mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300">
          {error}
        </Card>
      )}

      {!entries && !error && (
        <div className="stagger grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i} className="h-48 animate-pulse bg-white/5">
              {null}
            </Card>
          ))}
        </div>
      )}

      {entries && entries.length === 0 && (
        <Card className="border-dashed text-center text-muted">
          {t.evaluations.empty}
        </Card>
      )}

      {entries && entries.length > 0 && (
        <div className="stagger grid gap-4 md:grid-cols-2">
          {entries.map((entry) => {
            const scorePercent =
              entry.evaluation?.scorePercent ??
              (typeof entry.understanding === "number"
                ? Math.round(entry.understanding * 100)
                : 0);
            const confidencePercent =
              typeof entry.confidence === "number"
                ? Math.round(entry.confidence * 100)
                : null;
            const grade = gradeFor(scorePercent);
            const totalLessons = entry.evaluation?.totalLessons || entry.totalLessons || 0;
            const lessonsCompleted =
              entry.evaluation?.lessonsCompleted ??
              (typeof entry.lessonIndex === "number" ? entry.lessonIndex + 1 : 1);

            return (
              <Card key={entry.materialsKey} className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {entry.materialNames.join(", ") ||
                        entry.lessonName ||
                        t.student.aiPageTitle}
                    </h3>
                    {entry.lessonName && (
                      <p className="mt-0.5 text-sm text-muted">{entry.lessonName}</p>
                    )}
                    {totalLessons > 0 && (
                      <p className="mt-0.5 text-xs text-muted">
                        {t.evaluations.progress
                          .replace("{current}", String(Math.max(1, lessonsCompleted)))
                          .replace("{total}", String(totalLessons))}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-xs font-bold",
                      gradeColor(grade)
                    )}
                  >
                    {grade === "excellent"
                      ? t.evaluations.gradeExcellent
                      : grade === "good"
                        ? t.evaluations.gradeGood
                        : grade === "fair"
                          ? t.evaluations.gradeFair
                          : t.evaluations.gradeNeedsWork}
                  </span>
                </div>

                <div className="space-y-2">
                  <ScoreBar
                    label={t.evaluations.understanding}
                    percent={scorePercent}
                  />
                  {confidencePercent != null && (
                    <ScoreBar
                      label={t.evaluations.confidence}
                      percent={confidencePercent}
                    />
                  )}
                </div>

                {entry.evaluation ? (
                  <>
                    <p className="text-sm leading-relaxed text-foreground">
                      {entry.evaluation.summary}
                    </p>
                    {entry.evaluation.strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                          {t.evaluations.strengths}
                        </p>
                        <ul className="mt-1 flex flex-wrap gap-1.5">
                          {entry.evaluation.strengths.map((s, i) => (
                            <li
                              key={i}
                              className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200"
                            >
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {entry.evaluation.weaknesses.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                          {t.evaluations.weaknesses}
                        </p>
                        <ul className="mt-1 flex flex-wrap gap-1.5">
                          {entry.evaluation.weaknesses.map((s, i) => (
                            <li
                              key={i}
                              className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200"
                            >
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {entry.evaluation.recommendation && (
                      <p className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-foreground">
                        <span className="font-semibold text-accent">
                          {t.evaluations.recommendation}:{" "}
                        </span>
                        {entry.evaluation.recommendation}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted">{t.evaluations.pendingEvaluation}</p>
                )}

                <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                  <span className="text-xs text-muted">
                    {t.evaluations.updatedAt.replace(
                      "{date}",
                      new Date(entry.updatedAt).toLocaleDateString(dateLocale)
                    )}
                  </span>
                  <Button variant="outline" onClick={() => continueMaterial(entry)}>
                    {t.evaluations.continueLesson}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, percent }: { label: string; percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-semibold text-foreground">{clamped}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
