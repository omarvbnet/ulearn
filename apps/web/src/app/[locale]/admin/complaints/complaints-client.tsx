"use client";

import { Badge, Button, Card, PageHeader, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Complaint = {
  id: string;
  subject: string;
  description: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  student: { fullLegalName: string | null; phone: string };
  teacher: { user: { fullLegalName: string | null } } | null;
  handledBy: { fullLegalName: string | null } | null;
};

export function ComplaintsClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState("OPEN");
  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [resolution, setResolution] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setComplaints(null);
    const qs = tab === "ALL" ? "" : `?status=${tab}`;
    fetch(`/api/admin/complaints${qs}`)
      .then((r) => (r.ok ? r.json() : { complaints: [] }))
      .then((d) => setComplaints(d.complaints || []));
  }, [tab]);

  useEffect(load, [load]);

  async function resolve(status: "RESOLVED" | "DISMISSED") {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/admin/complaints/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, resolution: resolution || undefined }),
    });
    setSaving(false);
    if (res.ok) {
      toast(status === "RESOLVED" ? "Complaint resolved" : "Complaint dismissed");
      setSelected(null);
      setResolution("");
      load();
    } else {
      toast("Failed to update complaint", "error");
    }
  }

  return (
    <div>
      <PageHeader title="Complaints" description="Student complaints and their resolution" />

      <Tabs
        tabs={[
          { id: "OPEN", label: "Open" },
          { id: "RESOLVED", label: "Resolved" },
          { id: "DISMISSED", label: "Dismissed" },
          { id: "ALL", label: "All" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-6">
        {complaints === null ? (
          <SkeletonRows rows={4} />
        ) : complaints.length === 0 ? (
          <EmptyState title="No complaints" hint="Nothing to review in this tab." />
        ) : (
          <div className="stagger space-y-3">
            {complaints.map((c) => (
              <Card key={c.id} className="card-hover cursor-pointer" onClick={() => { setSelected(c); setResolution(c.resolution ?? ""); }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{c.subject}</p>
                  <Badge status={c.status === "RESOLVED" ? "APPROVED" : c.status === "OPEN" ? "PENDING" : "SUSPENDED"}>
                    {c.status}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>
                <p className="mt-2 text-xs text-muted">
                  {c.student.fullLegalName} · <span dir="ltr">{c.student.phone}</span>
                  {c.teacher && <> · vs {c.teacher.user.fullLegalName}</>}
                  {" · "}
                  {new Date(c.createdAt).toLocaleString()}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <Modal open onClose={() => setSelected(null)} title={selected.subject}>
          <div className="space-y-4">
            <p className="text-sm">{selected.description}</p>
            <p className="text-xs text-muted">
              From {selected.student.fullLegalName} (<span dir="ltr">{selected.student.phone}</span>)
              {selected.teacher && <> — about {selected.teacher.user.fullLegalName}</>}
            </p>
            <Textarea
              label="Resolution note"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Describe how this was handled…"
            />
            <div className="flex gap-3">
              <Button disabled={saving} onClick={() => resolve("RESOLVED")}>
                Resolve
              </Button>
              <Button variant="outline" disabled={saving} onClick={() => resolve("DISMISSED")}>
                Dismiss
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
