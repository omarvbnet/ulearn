"use client";

import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { EmptyState, SkeletonRows, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type TeacherRequest = {
  id: string;
  fullLegalName: string | null;
  phone: string;
  email: string | null;
  status: string;
  gender: string | null;
  nationalId: string | null;
  nationalIdImage: string | null;
  createdAt: string;
  country?: { nameEn: string } | null;
  province?: { nameEn: string } | null;
  teacherProfile?: {
    teachingTrack: "SCHOOL" | "CERTIFICATE";
    bio: string | null;
    specializations: string[];
    subjects: {
      subject: {
        id: string;
        nameEn: string;
        nameAr: string | null;
      };
    }[];
  } | null;
};

export function TeacherRequestsClient() {
  const { toast } = useToast();
  const [items, setItems] = useState<TeacherRequest[] | null>(null);
  const [status, setStatus] = useState("PENDING");
  const [track, setTrack] = useState<"ALL" | "SCHOOL" | "CERTIFICATE">("ALL");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setItems(null);
    const params = new URLSearchParams({
      role: "TEACHER",
      status,
      includeTeacher: "1",
    });
    if (q.trim()) params.set("q", q.trim());
    fetch(`/api/admin/users?${params}`)
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => {
        let list = (d.users || []) as TeacherRequest[];
        if (track !== "ALL") {
          list = list.filter(
            (u) => u.teacherProfile?.teachingTrack === track
          );
        }
        setItems(list);
      });
  }, [status, q, track]);

  useEffect(load, [load]);

  async function approve(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/admin/users/${id}/approve`, { method: "POST" });
    setBusyId(null);
    if (res.ok) {
      toast("Teacher approved — they can now sign in with their phone");
      load();
    } else {
      toast("Failed", "error");
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Rejection reason (optional):") ?? undefined;
    setBusyId(id);
    const res = await fetch(`/api/admin/users/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusyId(null);
    if (res.ok) {
      toast("Application rejected");
      load();
    } else {
      toast("Failed", "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Teacher Registration Requests"
        description="Approve or reject school and certificate teacher applications. Approved teachers sign in with their phone number."
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <Input
          placeholder="Search name, phone, email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <select
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <select
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          value={track}
          onChange={(e) =>
            setTrack(e.target.value as "ALL" | "SCHOOL" | "CERTIFICATE")
          }
        >
          <option value="ALL">All tracks</option>
          <option value="SCHOOL">School courses</option>
          <option value="CERTIFICATE">Certificate courses</option>
        </select>
      </div>

      {items === null ? (
        <SkeletonRows rows={4} />
      ) : items.length === 0 ? (
        <EmptyState title="No teacher requests in this filter" />
      ) : (
        <div className="stagger space-y-3">
          {items.map((u) => {
            const trackLabel =
              u.teacherProfile?.teachingTrack === "CERTIFICATE"
                ? "Certificate"
                : "School";
            const subjects =
              u.teacherProfile?.subjects.map((s) => s.subject.nameEn) ??
              u.teacherProfile?.specializations ??
              [];
            return (
              <Card key={u.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">
                        {u.fullLegalName || "Unnamed"}
                      </p>
                      <Badge
                        status={
                          u.teacherProfile?.teachingTrack === "CERTIFICATE"
                            ? "APPROVED"
                            : "PENDING"
                        }
                      >
                        {trackLabel}
                      </Badge>
                      <Badge
                        status={
                          u.status === "APPROVED"
                            ? "APPROVED"
                            : u.status === "REJECTED"
                              ? "SUSPENDED"
                              : "PENDING"
                        }
                      >
                        {u.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted" dir="ltr">
                      {u.phone}
                      {u.email ? ` · ${u.email}` : ""}
                    </p>
                    <p className="text-xs text-muted">
                      {[u.country?.nameEn, u.province?.nameEn]
                        .filter(Boolean)
                        .join(" · ") || "—"}{" "}
                      · applied {new Date(u.createdAt).toLocaleString()}
                    </p>
                    {subjects.length > 0 && (
                      <p className="text-sm">
                        <span className="text-muted">
                          {u.teacherProfile?.teachingTrack === "CERTIFICATE"
                            ? "Insights: "
                            : "Specialties: "}
                        </span>
                        {subjects.join(", ")}
                      </p>
                    )}
                    {u.teacherProfile?.bio && (
                      <p className="text-sm text-muted">{u.teacherProfile.bio}</p>
                    )}
                    {u.nationalIdImage && (
                      <a
                        href={u.nationalIdImage}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-accent hover:underline"
                      >
                        View national ID
                      </a>
                    )}
                  </div>
                  {u.status === "PENDING" && (
                    <div className="flex gap-2">
                      <Button
                        disabled={busyId === u.id}
                        onClick={() => approve(u.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busyId === u.id}
                        onClick={() => reject(u.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
