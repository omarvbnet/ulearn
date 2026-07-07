"use client";

import { Badge, Button, Card, PageHeader, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Course = {
  id: string;
  titleEn: string;
  description: string | null;
  price: number;
  currency: string;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
  teacher: {
    id: string;
    level: string;
    isActive: boolean;
    user: { fullLegalName: string | null; phone: string };
  };
  stage: { nameEn: string };
  subject: { nameEn: string };
  lessons: { id: string; title: string; durationSec: number | null }[];
  _count: { purchases: number };
};

type Purchase = {
  id: string;
  price: number;
  currency: string;
  status: string;
  createdAt: string;
  user: { fullLegalName: string | null; phone: string };
  course: {
    titleEn: string;
    teacher: { level: string; user: { fullLegalName: string | null } };
  };
};

const LEVEL_BADGE: Record<string, "APPROVED" | "PENDING" | "SUSPENDED"> = {
  MASTER: "APPROVED",
  EXCELLENT: "APPROVED",
  GOOD: "PENDING",
  NEEDS_IMPROVEMENT: "SUSPENDED",
};

export function CourseReviewClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState("PENDING_REVIEW");
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [selected, setSelected] = useState<Course | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCourses = useCallback(() => {
    setCourses(null);
    const qs = tab === "PURCHASES" ? "" : `?status=${tab}`;
    if (tab !== "PURCHASES") {
      fetch(`/api/admin/teacher-courses${qs}`)
        .then((r) => (r.ok ? r.json() : { courses: [] }))
        .then((d) => setCourses(d.courses || []));
    } else {
      setPurchases(null);
      fetch("/api/admin/course-purchases?status=PENDING")
        .then((r) => (r.ok ? r.json() : { purchases: [] }))
        .then((d) => setPurchases(d.purchases || []));
    }
  }, [tab]);

  useEffect(loadCourses, [loadCourses]);

  async function review(decision: "APPROVED" | "REJECTED") {
    if (!selected) return;
    setBusy(true);
    const res = await fetch(`/api/admin/teacher-courses/${selected.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, notes: notes || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      toast(decision === "APPROVED" ? "Course approved and published" : "Course rejected");
      setSelected(null);
      setNotes("");
      loadCourses();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.error === "TEACHER_BLOCKED" ? "Teacher account is blocked" : "Failed", "error");
    }
  }

  async function handlePurchase(purchaseId: string, action: "approve" | "reject") {
    const res = await fetch("/api/admin/course-purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseId, action }),
    });
    if (res.ok) {
      toast(action === "approve" ? "Payment confirmed — course unlocked" : "Purchase rejected");
      loadCourses();
    } else {
      toast("Failed", "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Course Review"
        description="Review teacher courses before they go live, and confirm course payments"
      />

      <Tabs
        tabs={[
          { id: "PENDING_REVIEW", label: "Pending Review" },
          { id: "APPROVED", label: "Live" },
          { id: "REJECTED", label: "Rejected" },
          { id: "CLOSED", label: "Closed" },
          { id: "PURCHASES", label: "Purchase Requests" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-6">
        {tab === "PURCHASES" ? (
          purchases === null ? (
            <SkeletonRows rows={3} />
          ) : purchases.length === 0 ? (
            <EmptyState title="No pending purchases" />
          ) : (
            <div className="stagger space-y-3">
              {purchases.map((p) => (
                <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-semibold">{p.user.fullLegalName}</p>
                    <p className="text-sm text-muted" dir="ltr">{p.user.phone}</p>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">{p.course.titleEn}</p>
                    <p className="text-muted">
                      by {p.course.teacher.user.fullLegalName} ·{" "}
                      <Badge status={LEVEL_BADGE[p.course.teacher.level]}>
                        {p.course.teacher.level.replace(/_/g, " ")}
                      </Badge>
                    </p>
                  </div>
                  <p className="font-semibold text-accent">
                    {p.price} {p.currency}
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={() => handlePurchase(p.id, "approve")}>
                      Confirm Payment
                    </Button>
                    <Button variant="danger" onClick={() => handlePurchase(p.id, "reject")}>
                      Reject
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : courses === null ? (
          <SkeletonRows rows={3} />
        ) : courses.length === 0 ? (
          <EmptyState title="No courses in this tab" />
        ) : (
          <div className="stagger space-y-3">
            {courses.map((c) => (
              <Card
                key={c.id}
                className="card-hover cursor-pointer"
                onClick={() => { setSelected(c); setNotes(c.reviewNotes ?? ""); }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{c.titleEn}</p>
                    <p className="mt-1 text-sm text-muted">
                      {c.subject.nameEn} · {c.stage.nameEn} · {c.lessons.length} lessons ·{" "}
                      {c._count.purchases} sales
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-accent">
                      {c.price} {c.currency}
                    </span>
                    <Badge status={LEVEL_BADGE[c.teacher.level]}>
                      {c.teacher.level.replace(/_/g, " ")}
                    </Badge>
                    {!c.teacher.isActive && <Badge status="SUSPENDED">Teacher blocked</Badge>}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {c.teacher.user.fullLegalName} · <span dir="ltr">{c.teacher.user.phone}</span> ·{" "}
                  {new Date(c.createdAt).toLocaleString()}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <Modal open onClose={() => setSelected(null)} title={selected.titleEn} wide>
          <div className="space-y-4">
            {selected.description && <p className="text-sm">{selected.description}</p>}
            <div className="text-sm text-muted">
              <p>
                Teacher: {selected.teacher.user.fullLegalName} (
                {selected.teacher.level.replace(/_/g, " ")})
              </p>
              <p>
                {selected.subject.nameEn} · {selected.stage.nameEn} · {selected.price}{" "}
                {selected.currency}
              </p>
            </div>
            {selected.lessons.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-card-border p-3 text-sm">
                {selected.lessons.map((l, i) => (
                  <li key={l.id}>
                    {i + 1}. {l.title}
                  </li>
                ))}
              </ul>
            )}
            <Textarea
              label="Review notes (sent to the teacher on rejection)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex gap-3">
              <Button disabled={busy} onClick={() => review("APPROVED")}>
                Approve & Publish
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => review("REJECTED")}>
                Reject
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
