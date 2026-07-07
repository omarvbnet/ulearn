"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
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

export default function StudentHomePage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const [user, setUser] = useState<{ fullLegalName?: string; status?: string } | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {});

    fetch("/api/courses")
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((d) => setSubjects(d.subjects || []))
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
                    <Badge status="FREE">{freeCount} {t.student.freeLessons}</Badge>
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
