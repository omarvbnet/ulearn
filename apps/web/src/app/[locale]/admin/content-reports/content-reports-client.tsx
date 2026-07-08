"use client";

import { Badge, Button, Card, PageHeader, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Report = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  reporter: { fullLegalName: string | null; phone: string; role: string };
  targetSummary: { title: string | null; subtitle: string | null };
};

const REASON_LABELS: Record<string, string> = {
  INAPPROPRIATE: "Inappropriate content",
  SPAM: "Spam or misleading",
  HARASSMENT: "Harassment or hate speech",
  COPYRIGHT: "Copyright violation",
  VIOLENCE: "Violence or dangerous acts",
  MISLEADING: "False or misleading information",
  OTHER: "Other",
};

const TARGET_LABELS: Record<string, string> = {
  SHORT_VIDEO: "Reel",
  STORE_COURSE: "Course",
  STORE_LESSON: "Lesson",
};

export function ContentReportsClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState("PENDING");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [selected, setSelected] = useState<Report | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setReports(null);
    fetch(`/api/admin/content-reports?status=${tab}`)
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => setReports(d.reports || []));
  }, [tab]);

  useEffect(load, [load]);

  async function update(status: "REVIEWED" | "DISMISSED" | "ACTION_TAKEN") {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/admin/content-reports/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, adminNotes: adminNotes || undefined }),
    });
    setSaving(false);
    if (res.ok) {
      toast("Report updated");
      setSelected(null);
      setAdminNotes("");
      load();
    } else {
      toast("Failed to update report", "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Content Reports"
        description="User-submitted reports on reels, courses, and lessons"
      />

      <Tabs
        tabs={[
          { id: "PENDING", label: "Pending" },
          { id: "REVIEWED", label: "Reviewed" },
          { id: "DISMISSED", label: "Dismissed" },
          { id: "ACTION_TAKEN", label: "Action taken" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-6">
        {reports === null ? (
          <SkeletonRows rows={4} />
        ) : reports.length === 0 ? (
          <EmptyState title="No reports" hint="Nothing to review in this tab." />
        ) : (
          <div className="stagger space-y-3">
            {reports.map((r) => (
              <Card
                key={r.id}
                className="card-hover cursor-pointer"
                onClick={() => {
                  setSelected(r);
                  setAdminNotes(r.adminNotes ?? "");
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">
                    {TARGET_LABELS[r.targetType] ?? r.targetType}: {r.targetSummary.title}
                  </p>
                  <Badge
                    status={
                      r.status === "PENDING"
                        ? "PENDING"
                        : r.status === "ACTION_TAKEN"
                          ? "APPROVED"
                          : "SUSPENDED"
                    }
                  >
                    {r.status.replace("_", " ")}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-accent">{REASON_LABELS[r.reason] ?? r.reason}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{r.details}</p>
                <p className="mt-2 text-xs text-muted">
                  By {r.reporter.fullLegalName} · <span dir="ltr">{r.reporter.phone}</span>
                  {" · "}
                  {new Date(r.createdAt).toLocaleString()}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <Modal open onClose={() => setSelected(null)} title="Content report">
          <div className="space-y-4">
            <div className="rounded-lg bg-white/5 p-3 text-sm">
              <p className="font-medium">
                {TARGET_LABELS[selected.targetType]} — {selected.targetSummary.title}
              </p>
              {selected.targetSummary.subtitle && (
                <p className="mt-1 text-muted">{selected.targetSummary.subtitle}</p>
              )}
            </div>
            <p className="text-sm">
              <span className="text-muted">Reason: </span>
              {REASON_LABELS[selected.reason]}
            </p>
            <p className="text-sm whitespace-pre-wrap">{selected.details}</p>
            <p className="text-xs text-muted">
              Reported by {selected.reporter.fullLegalName} ({selected.reporter.role})
            </p>
            {tab === "PENDING" && (
              <>
                <Textarea
                  label="Admin notes"
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Internal notes or resolution summary…"
                />
                <div className="flex flex-wrap gap-3">
                  <Button disabled={saving} onClick={() => update("REVIEWED")}>
                    Mark reviewed
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => update("ACTION_TAKEN")}>
                    Action taken
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => update("DISMISSED")}>
                    Dismiss
                  </Button>
                </div>
              </>
            )}
            {selected.adminNotes && (
              <p className="rounded-lg bg-white/5 p-3 text-sm">{selected.adminNotes}</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
