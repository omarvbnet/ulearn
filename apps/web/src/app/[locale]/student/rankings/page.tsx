"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";

type Rank = { rank: number; name: string; watchSec?: number; avgScore?: number };

export default function StudentRankingsPage() {
  const t = useT();
  const [data, setData] = useState<{
    topStudents: Rank[];
    topCertificateUsers: Rank[];
    highestScores: Rank[];
    mostActive: Rank[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/rankings")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, []);

  const sections = data
    ? [
        { title: t.rank.topStudents, rows: data.topStudents },
        { title: t.rank.topCertificateUsers, rows: data.topCertificateUsers },
        { title: t.rank.highestScores, rows: data.highestScores },
        { title: t.rank.mostActive, rows: data.mostActive },
      ]
    : [];

  return (
    <div>
      <PageHeader title={t.rank.title} description={t.rank.description} />
      <div className="stagger grid gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.title}>
            <h2 className="mb-4 font-semibold text-accent">{s.title}</h2>
            <ol className="space-y-2">
              {s.rows.length === 0 && (
                <li className="text-sm text-muted">{t.rank.noRankings}</li>
              )}
              {s.rows.map((r) => (
                <li
                  key={`${s.title}-${r.rank}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span>
                    <span className="me-2 font-bold text-primary">#{r.rank}</span>
                    {r.name}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </div>
  );
}
