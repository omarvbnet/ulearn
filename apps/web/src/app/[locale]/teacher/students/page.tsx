"use client";

import { Input, PageHeader } from "@/components/ui";
import { EmptyState, SkeletonRows } from "@/components/overlay";
import { useEffect, useMemo, useState } from "react";

type Student = {
  id: string;
  fullLegalName: string | null;
  phone: string;
  role: string;
  lastActivityAt?: string | null;
  country?: { nameEn: string } | null;
  province?: { nameEn: string } | null;
  watchSec: number;
  avgQuizScore: number | null;
};

export default function TeacherStudentsPage() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/teacher/students").then(async (r) => {
      setStudents(r.ok ? (await r.json()).students : []);
    });
  }, []);

  const filtered = useMemo(() => {
    if (!students) return null;
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.fullLegalName?.toLowerCase().includes(q) || s.phone.includes(q)
    );
  }, [students, search]);

  return (
    <div>
      <PageHeader title="Students" description="Students enrolled in your subjects" />

      <div className="mb-4 max-w-sm">
        <Input placeholder="Search by name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered === null ? (
        <SkeletonRows rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No students found" hint="Students appear once they subscribe to your subjects." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-xs uppercase tracking-wide text-muted">
                <th className="p-3 text-start">Student</th>
                <th className="p-3 text-start">Location</th>
                <th className="p-3 text-start">Watch time</th>
                <th className="p-3 text-start">Avg quiz</th>
                <th className="p-3 text-start">Last active</th>
              </tr>
            </thead>
            <tbody className="stagger">
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-card-border/40 transition hover:bg-white/[0.02]">
                  <td className="p-3">
                    <p className="font-medium">{s.fullLegalName ?? "—"}</p>
                    <p className="text-xs text-muted" dir="ltr">{s.phone}</p>
                  </td>
                  <td className="p-3 text-muted">
                    {[s.province?.nameEn, s.country?.nameEn].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="p-3">
                    <span className="text-accent">{formatWatch(s.watchSec)}</span>
                  </td>
                  <td className="p-3">
                    {s.avgQuizScore !== null ? `${Math.round(s.avgQuizScore)}%` : "—"}
                  </td>
                  <td className="p-3 text-muted">
                    {s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatWatch(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
