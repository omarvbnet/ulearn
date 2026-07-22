"use client";

import { Button, Card, PageHeader } from "@/components/ui";
import { EmptyState, ProgressBar, SkeletonRows, useToast } from "@/components/overlay";
import { useT } from "@/i18n/client";
import { useCallback, useEffect, useState } from "react";

type Certificate = {
  id: string;
  certificateNumber: string;
  verificationCode: string;
  userName: string;
  courseName: string;
  completionDate: string;
  totalHours: number;
  qrCodeData?: string | null;
};

type Program = {
  subject: { id: string; nameEn: string; totalHours: number };
  eligible: boolean;
  reason?: string;
  completionPct?: number;
};

export default function StudentCertificatesPage() {
  const t = useT();
  const { toast } = useToast();
  const [certificates, setCertificates] = useState<Certificate[] | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/certificates");
    if (res.ok) {
      const d = await res.json();
      setCertificates(d.certificates);
      setPrograms(d.programs);
    } else {
      setCertificates([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function claim(subjectId: string) {
    setClaiming(subjectId);
    const res = await fetch("/api/certificates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId }),
    });
    setClaiming(null);
    if (res.ok) {
      toast("Certificate issued — congratulations!");
      load();
    } else {
      const err = await res.json().catch(() => null);
      toast(err?.error === "QUIZ_NOT_PASSED" ? "Pass the final quiz first" : "Not eligible yet", "error");
    }
  }

  return (
    <div>
      <PageHeader
        title={t.nav.certificates}
        description={t.student.certificatesDescription}
      />

      {certificates === null ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="space-y-8">
          {/* Earned */}
          {certificates.length === 0 && programs.length === 0 ? (
            <EmptyState
              title={t.student.noCertificates}
              hint={t.student.noCertificatesHint}
            />
          ) : (
            <>
              {certificates.length > 0 && (
                <div className="stagger grid gap-5 md:grid-cols-2">
                  {certificates.map((c) => (
                    <Card key={c.id} className="card-hover relative overflow-hidden p-6">
                      <div className="pointer-events-none absolute -end-10 -top-10 h-32 w-32 rounded-full bg-primary/15 blur-2xl" />
                      <p className="text-xs uppercase tracking-widest text-accent">{t.student.certOfCompletion}</p>
                      <h3 className="mt-2 text-xl font-bold">{c.courseName}</h3>
                      <p className="mt-1 text-sm text-muted">{t.student.awardedTo} {c.userName}</p>
                      <div className="mt-4 space-y-1 text-sm text-muted">
                        <p>No. <span className="font-mono text-foreground">{c.certificateNumber}</span></p>
                        <p>{new Date(c.completionDate).toLocaleDateString()} · {c.totalHours} {t.student.hours}</p>
                      </div>
                      <div className="mt-5 flex gap-2">
                        <a href={`/verify/${c.verificationCode}`} target="_blank" rel="noreferrer" className="flex-1">
                          <Button variant="outline" className="w-full !py-2 text-sm">{t.student.verifyOnline}</Button>
                        </a>
                        <a
                          href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(c.qrCodeData ?? "")}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button variant="outline" className="!py-2 text-sm">QR</Button>
                        </a>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* In progress */}
              {programs.length > 0 && (
                <div>
                  <h2 className="mb-4 text-lg font-bold">{t.student.certificatePrograms}</h2>
                  <div className="stagger space-y-3">
                    {programs.map((p) => (
                      <Card key={p.subject.id} className="flex flex-wrap items-center gap-4 p-5">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{p.subject.nameEn}</p>
                          <p className="text-sm text-muted">{p.subject.totalHours} {t.student.hours}</p>
                          <div className="mt-2 flex items-center gap-3">
                            <div className="max-w-xs flex-1">
                              <ProgressBar value={p.completionPct ?? 0} />
                            </div>
                            <span className="text-xs font-medium text-accent">
                              {Math.round(p.completionPct ?? 0)}%
                            </span>
                          </div>
                        </div>
                        {p.eligible ? (
                          <Button disabled={claiming === p.subject.id} onClick={() => claim(p.subject.id)}>
                            {claiming === p.subject.id ? t.student.issuing : t.student.claimCertificate}
                          </Button>
                        ) : (
                          <span className="badge badge-pending">
                            {p.reason === "QUIZ_NOT_PASSED" ? t.student.passFinalQuiz : t.student.completeAllLessons}
                          </span>
                        )}
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
