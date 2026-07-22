"use client";

import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { EmptyState, SkeletonRows, useToast } from "@/components/overlay";
import { useT } from "@/i18n/client";
import { getLocalizedField } from "@/lib/utils";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type StoreCourse = {
  id: string;
  titleEn: string;
  titleAr: string | null;
  titleKu: string | null;
  titleTr: string | null;
  description: string | null;
  price: number;
  currency: string;
  purchaseStatus: "PENDING" | "PAID" | "REJECTED" | null;
  teacher: { level: string; user: { fullLegalName: string | null } };
  stage: Record<string, unknown>;
  subject: Record<string, unknown>;
  lessons: { id: string; title: string; isFreePreview: boolean }[];
  _count: { purchases: number };
};

const LEVEL_LABEL: Record<string, string> = {
  MASTER: "★★★",
  EXCELLENT: "★★",
  GOOD: "★",
};

export default function CourseStorePage() {
  const t = useT();
  const { toast } = useToast();
  const { locale } = useParams<{ locale: string }>();
  const [courses, setCourses] = useState<StoreCourse[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/store/courses")
      .then((r) => (r.ok ? r.json() : { courses: [] }))
      .then((d) => setCourses(d.courses || []));
  }, []);

  useEffect(load, [load]);

  async function buy(id: string) {
    setBusy(id);
    const res = await fetch(`/api/store/courses/${id}/purchase`, { method: "POST" });
    setBusy(null);
    if (res.ok) {
      toast(t.student.purchaseRequested);
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.code === "ALREADY_REQUESTED" ? t.student.purchaseAlreadyRequested : "Failed", "error");
    }
  }

  return (
    <div>
      <PageHeader title={t.student.storeTitle} description={t.student.storeDescription} />

      {courses === null ? (
        <SkeletonRows rows={3} />
      ) : courses.length === 0 ? (
        <EmptyState title={t.student.storeEmpty} hint={t.student.storeEmptyHint} />
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => {
            const title =
              getLocalizedField(c as unknown as Record<string, unknown>, "title", locale) ||
              c.titleEn;
            return (
              <Card key={c.id} className="card-hover flex flex-col">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="font-semibold">{title}</p>
                  <span className="whitespace-nowrap font-bold text-accent">
                    {c.price} {c.currency}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {getLocalizedField(c.subject, "name", locale)} ·{" "}
                  {getLocalizedField(c.stage, "name", locale)}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {c.teacher.user.fullLegalName}{" "}
                  <span className="text-warning">{LEVEL_LABEL[c.teacher.level] ?? ""}</span>
                </p>
                {c.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted">{c.description}</p>
                )}
                <p className="mt-2 text-xs text-muted">
                  {c.lessons.length} {t.student.lessonsWord} · {c._count.purchases}{" "}
                  {t.student.enrolled}
                </p>
                <div className="mt-4 flex-1" />
                {c.purchaseStatus === "PAID" ? (
                  <Badge status="APPROVED">{t.student.purchased}</Badge>
                ) : c.purchaseStatus === "PENDING" ? (
                  <Badge status="PENDING">{t.student.purchasePending}</Badge>
                ) : (
                  <Button
                    disabled={busy === c.id}
                    onClick={() => buy(c.id)}
                    className="w-full"
                  >
                    {busy === c.id ? t.common.loading : t.student.buyCourse}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
