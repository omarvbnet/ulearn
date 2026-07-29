"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CertificateInsightsEditor } from "@/components/certificate-insights-editor";
import { Badge, Card, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { getLocalizedField } from "@/lib/utils";

type Subject = {
  id: string;
  nameEn: string;
  nameAr?: string;
  nameKu?: string;
  nameTr?: string;
  chapters: { lessons: { isFree: boolean }[] }[];
};

type AiExamStats = {
  total: number;
  passed: number;
  failed: number;
  avgScore: number;
};

export default function StudentHomePage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const [user, setUser] = useState<{ fullLegalName?: string; status?: string } | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [aiExamStats, setAiExamStats] = useState<AiExamStats | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {});

    fetch("/api/courses")
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((d) => setSubjects(d.subjects || []))
      .catch(() => {});

    fetch("/api/ai/exams/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.stats) setAiExamStats(d.stats);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader
        title={`${t.student.welcome}${user?.fullLegalName ? `, ${user.fullLegalName}` : ""}`}
        description={t.student.continueLearning}
      />

      {user?.status === "PENDING" && (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-warning">
          {t.student.underReview}
        </div>
      )}

      <CertificateInsightsEditor />

      <Link href={`/${locale}/student/ai`} className="mb-6 block">
        <Card className="card-hover overflow-hidden border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 to-transparent">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                U Learn AI Teacher
              </p>
              <h3 className="text-lg font-semibold">
                {locale === "ar"
                  ? "الفصل المباشر (سبورة + صوت)"
                  : locale === "tr"
                    ? "Canlı sınıf (tahta + ses)"
                    : locale === "ku"
                      ? "پۆلی ڕاستەوخۆ (تەختە + دەنگ)"
                      : "Live AI Classroom (board + voice)"}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {locale === "ar"
                  ? "افتح مساعد الذكاء، اضغط معلم السبورة، اختر المادة، وابدأ الدرس التفاعلي."
                  : "Open AI Assistant, tap AI Teacher (board), pick a material, then start the live lesson."}
              </p>
            </div>
            <span className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-emerald-950">
              {locale === "ar" ? "ابدأ الآن" : "Start now"}
            </span>
          </div>
        </Card>
      </Link>

      {aiExamStats && (
        <Link href={`/${locale}/student/ai`} className="mb-6 block">
          <Card className="card-hover overflow-hidden border-accent/25 bg-gradient-to-br from-accent/10 to-transparent">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{t.student.aiExamsTitle}</h3>
                <p className="mt-1 text-sm text-muted">{t.student.aiExamsCta}</p>
              </div>
              <div className="flex gap-6">
                <Stat label={t.student.aiExamsTotal} value={aiExamStats.total} />
                <Stat label={t.student.aiExamsPassed} value={aiExamStats.passed} tone="ok" />
                <Stat label={t.student.aiExamsFailed} value={aiExamStats.failed} tone="bad" />
              </div>
            </div>
          </Card>
        </Link>
      )}

      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {subjects.slice(0, 6).map((s) => {
          const freeCount = s.chapters.reduce(
            (n, c) => n + c.lessons.filter((l) => l.isFree).length,
            0
          );
          return (
            <Link key={s.id} href={`/${locale}/student/courses`}>
              <Card className="card-hover h-full">
                <h3 className="font-semibold">{getLocalizedField(s, "name", locale)}</h3>
                <p className="mt-2 text-sm text-muted">
                  {s.chapters.length} {t.student.chapters}
                </p>
                {freeCount > 0 && (
                  <div className="mt-3">
                    <Badge status="FREE">
                      {freeCount} {t.student.freeLessons}
                    </Badge>
                  </div>
                )}
              </Card>
            </Link>
          );
        })}
        {subjects.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3 text-center text-muted">
            {t.student.noCourses}
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "bad";
}) {
  return (
    <div className="text-center">
      <div
        className={
          tone === "ok"
            ? "text-2xl font-extrabold text-emerald-400"
            : tone === "bad"
              ? "text-2xl font-extrabold text-red-400"
              : "text-2xl font-extrabold"
        }
      >
        {value}
      </div>
      <div className="text-xs font-medium text-muted">{label}</div>
    </div>
  );
}
