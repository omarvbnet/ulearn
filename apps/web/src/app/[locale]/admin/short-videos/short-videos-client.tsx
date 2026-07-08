"use client";

import { Badge, Button, Card, PageHeader, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type ShortVideo = {
  id: string;
  title: string;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
  teacher: {
    level: string;
    user: { fullLegalName: string | null; phone: string };
  };
  _count: { likes: number; comments: number };
};

export function ShortVideosClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState("PENDING_REVIEW");
  const [videos, setVideos] = useState<ShortVideo[] | null>(null);
  const [selected, setSelected] = useState<ShortVideo | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setVideos(null);
    fetch(`/api/admin/short-videos?status=${tab}`)
      .then((r) => (r.ok ? r.json() : { videos: [] }))
      .then((d) => setVideos(d.videos || []));
  }, [tab]);

  useEffect(load, [load]);

  async function review(decision: "APPROVED" | "REJECTED") {
    if (!selected) return;
    setBusy(true);
    const res = await fetch(`/api/admin/short-videos/${selected.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, notes: notes || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      toast(decision === "APPROVED" ? "Short video approved" : "Short video rejected");
      setSelected(null);
      setNotes("");
      load();
    } else {
      toast("Failed to update video", "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Short Videos"
        description="Review teacher reels before they appear in the mobile app"
      />

      <Tabs
        tabs={[
          { id: "PENDING_REVIEW", label: "Pending" },
          { id: "APPROVED", label: "Live" },
          { id: "REJECTED", label: "Rejected" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-6">
        {videos === null ? (
          <SkeletonRows rows={4} />
        ) : videos.length === 0 ? (
          <EmptyState title="No videos" hint="Nothing to review in this tab." />
        ) : (
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((v) => (
              <Card
                key={v.id}
                className="card-hover cursor-pointer overflow-hidden"
                onClick={() => {
                  setSelected(v);
                  setNotes(v.reviewNotes ?? "");
                }}
              >
                <div className="aspect-[9/16] max-h-64 overflow-hidden rounded-lg bg-black/40">
                  {v.fileUrl ? (
                    <video
                      src={v.fileUrl}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                      poster={v.thumbnailUrl ?? undefined}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted">No preview</div>
                  )}
                </div>
                <div className="mt-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium line-clamp-2">{v.title}</p>
                    <Badge status={v.status === "APPROVED" ? "APPROVED" : v.status === "PENDING_REVIEW" ? "PENDING" : "SUSPENDED"}>
                      {v.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {v.teacher.user.fullLegalName} · <span dir="ltr">{v.teacher.user.phone}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {v._count.likes} likes · {v._count.comments} comments
                    {v.durationSec ? ` · ${Math.round(v.durationSec / 60)}m` : ""}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <Modal open onClose={() => setSelected(null)} title={selected.title} wide>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="aspect-[9/16] max-h-[420px] overflow-hidden rounded-xl bg-black">
              {selected.fileUrl ? (
                <video src={selected.fileUrl} controls className="h-full w-full object-contain" playsInline />
              ) : (
                <div className="flex h-full items-center justify-center text-muted">No preview</div>
              )}
            </div>
            <div className="space-y-4">
              <p className="text-sm text-muted">
                Teacher: {selected.teacher.user.fullLegalName} ({selected.teacher.level.replace("_", " ")})
              </p>
              <p className="text-xs text-muted">
                Submitted {new Date(selected.createdAt).toLocaleString()}
              </p>
              {tab === "PENDING_REVIEW" && (
                <>
                  <Textarea
                    label="Review notes (optional for approval, recommended for rejection)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Explain why this was rejected or any admin notes…"
                  />
                  <div className="flex gap-3">
                    <Button disabled={busy} onClick={() => review("APPROVED")}>
                      Approve
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => review("REJECTED")}>
                      Reject
                    </Button>
                  </div>
                </>
              )}
              {selected.reviewNotes && (
                <p className="rounded-lg bg-white/5 p-3 text-sm">{selected.reviewNotes}</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
