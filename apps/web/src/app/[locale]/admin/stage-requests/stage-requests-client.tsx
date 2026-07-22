"use client";

import { Badge, Button, Card, PageHeader, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type StageName = { id: string; nameEn: string };

type StageRequest = {
  id: string;
  status: string;
  note: string | null;
  reviewNotes: string | null;
  certificateUrl: string | null;
  createdAt: string;
  reviewedAt: string | null;
  user: { id: string; fullLegalName: string | null; phone: string };
  currentStage: StageName | null;
  requestedStage: StageName;
};

const STATUS_BADGE: Record<string, "PENDING" | "APPROVED" | "SUSPENDED"> = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "SUSPENDED",
};

export function StageRequestsClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState("PENDING");
  const [requests, setRequests] = useState<StageRequest[] | null>(null);
  const [selected, setSelected] = useState<StageRequest | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRequests(null);
    fetch(`/api/admin/stage-requests?status=${tab}`)
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setRequests(d.requests || []));
  }, [tab]);

  useEffect(load, [load]);

  async function review(decision: "APPROVED" | "REJECTED") {
    if (!selected) return;
    setBusy(true);
    const res = await fetch(`/api/admin/stage-requests/${selected.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, notes: notes || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      toast(
        decision === "APPROVED"
          ? "Request approved — student moved to the new stage"
          : "Request rejected"
      );
      setSelected(null);
      setNotes("");
      load();
    } else {
      toast("Failed to review request", "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Stage Change Requests"
        description="Students request to move to a different educational stage with a certificate attached"
      />

      <Tabs
        tabs={[
          { id: "PENDING", label: "Pending" },
          { id: "APPROVED", label: "Approved" },
          { id: "REJECTED", label: "Rejected" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-6">
        {requests === null ? (
          <SkeletonRows rows={3} />
        ) : requests.length === 0 ? (
          <EmptyState title="No requests in this tab" />
        ) : (
          <div className="stagger space-y-3">
            {requests.map((r) => (
              <Card
                key={r.id}
                className="card-hover cursor-pointer"
                onClick={() => {
                  setSelected(r);
                  setNotes(r.reviewNotes ?? "");
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{r.user.fullLegalName || "Student"}</p>
                    <p className="text-sm text-muted" dir="ltr">
                      {r.user.phone}
                    </p>
                  </div>
                  <p className="text-sm">
                    {r.currentStage?.nameEn ?? "No stage"} →{" "}
                    <span className="font-medium">{r.requestedStage.nameEn}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    {r.certificateUrl && (
                      <a
                        href={r.certificateUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-accent underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Certificate
                      </a>
                    )}
                    <Badge status={STATUS_BADGE[r.status]}>{r.status}</Badge>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {new Date(r.createdAt).toLocaleString()}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <Modal
          open
          onClose={() => setSelected(null)}
          title={selected.user.fullLegalName || "Stage Request"}
        >
          <div className="space-y-4">
            <div className="text-sm">
              <p>
                <span className="text-muted">From:</span>{" "}
                {selected.currentStage?.nameEn ?? "No stage"}
              </p>
              <p>
                <span className="text-muted">To:</span> {selected.requestedStage.nameEn}
              </p>
              {selected.note && (
                <p>
                  <span className="text-muted">Student note:</span> {selected.note}
                </p>
              )}
            </div>
            {selected.certificateUrl && (
              <a
                href={selected.certificateUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-accent underline"
              >
                View attached certificate
              </a>
            )}
            {selected.status === "PENDING" ? (
              <>
                <Textarea
                  label="Review notes (sent to the student on rejection)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <div className="flex gap-3">
                  <Button disabled={busy} onClick={() => review("APPROVED")}>
                    Approve & Move Student
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => review("REJECTED")}>
                    Reject
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                Reviewed {selected.reviewedAt ? new Date(selected.reviewedAt).toLocaleString() : ""}
                {selected.reviewNotes ? ` · ${selected.reviewNotes}` : ""}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
