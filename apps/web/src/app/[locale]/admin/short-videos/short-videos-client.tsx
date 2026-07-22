"use client";

import { Badge, Button, Card, PageHeader, Textarea } from "@/components/ui";
import { AdminVideoFilters } from "@/components/admin-video-filters";
import { EmptyState, Modal, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { useCallback, useEffect, useMemo, useState } from "react";

type ShortVideo = {
  id: string;
  title: string;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  status: string;
  isHidden: boolean;
  deletedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  teacher: {
    level: string;
    user: { fullLegalName: string | null; phone: string };
  };
  _count: { likes: number; comments: number };
};

const TAB_STATUS: Record<string, string | undefined> = {
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
};

const TAB_VISIBILITY: Record<string, string> = {
  PENDING_REVIEW: "visible",
  APPROVED: "visible",
  HIDDEN: "hidden",
  REJECTED: "visible",
  DELETED: "deleted",
};

export function ShortVideosClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState("PENDING_REVIEW");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [visibility, setVisibility] = useState("visible");
  const [sort, setSort] = useState("newest");
  const [videos, setVideos] = useState<ShortVideo[] | null>(null);
  const [selected, setSelected] = useState<ShortVideo | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setVisibility(TAB_VISIBILITY[tab] ?? "visible");
  }, [tab]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    const status = TAB_STATUS[tab];
    if (status) params.set("status", status);
    params.set("visibility", TAB_VISIBILITY[tab] ?? visibility);
    if (debouncedQ) params.set("q", debouncedQ);
    if (sort) params.set("sort", sort);
    return params.toString();
  }, [tab, visibility, debouncedQ, sort]);

  const load = useCallback(() => {
    setVideos(null);
    fetch(`/api/admin/short-videos?${queryString}`)
      .then((r) => (r.ok ? r.json() : { videos: [] }))
      .then((d) => setVideos(d.videos || []));
  }, [queryString]);

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

  async function mutate(action: "hide" | "unhide" | "restore" | "delete") {
    if (!selected) return;
    if (action === "delete" && !confirm(`Delete "${selected.title}"? Teachers will be notified.`)) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/admin/short-videos/${selected.id}`, {
      method: action === "delete" ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      ...(action !== "delete" ? { body: JSON.stringify({ action }) } : {}),
    });
    setBusy(false);
    if (res.ok) {
      toast(
        action === "hide"
          ? "Video hidden"
          : action === "unhide"
            ? "Video visible again"
            : action === "restore"
              ? "Video restored"
              : "Video deleted"
      );
      setSelected(null);
      load();
    } else {
      toast("Action failed", "error");
    }
  }

  const canReview = tab === "PENDING_REVIEW" && selected && !selected.deletedAt;
  const canHide = selected && !selected.deletedAt && !selected.isHidden && selected.status === "APPROVED";
  const canUnhide = selected && !selected.deletedAt && selected.isHidden;
  const canDelete = selected && !selected.deletedAt;
  const canRestore = selected && selected.deletedAt;

  return (
    <div>
      <PageHeader
        title="Short Videos"
        description="Review, search, hide, or remove teacher reels"
      />

      <Tabs
        tabs={[
          { id: "PENDING_REVIEW", label: "Pending" },
          { id: "APPROVED", label: "Live" },
          { id: "HIDDEN", label: "Hidden" },
          { id: "REJECTED", label: "Rejected" },
          { id: "DELETED", label: "Deleted" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab !== "HIDDEN" && tab !== "DELETED" && (
        <AdminVideoFilters
          q={q}
          onQChange={setQ}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          sort={sort}
          onSortChange={setSort}
          sortOptions={[
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
            { value: "engagement", label: "Most engagement" },
          ]}
          placeholder="Search title, description, teacher, phone…"
        />
      )}

      {tab === "HIDDEN" || tab === "DELETED" ? (
        <div className="mt-4">
          <AdminVideoFilters
            q={q}
            onQChange={setQ}
            visibility={TAB_VISIBILITY[tab]}
            onVisibilityChange={() => {}}
            sort={sort}
            onSortChange={setSort}
            sortOptions={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "engagement", label: "Most engagement" },
            ]}
          />
        </div>
      ) : null}

      <div className="mt-6">
        {videos === null ? (
          <SkeletonRows rows={4} />
        ) : videos.length === 0 ? (
          <EmptyState title="No videos" hint="Try another tab or search term." />
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
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge
                        status={
                          v.deletedAt
                            ? "SUSPENDED"
                            : v.isHidden
                              ? "PENDING"
                              : v.status === "APPROVED"
                                ? "APPROVED"
                                : v.status === "PENDING_REVIEW"
                                  ? "PENDING"
                                  : "SUSPENDED"
                        }
                      >
                        {v.deletedAt ? "Deleted" : v.isHidden ? "Hidden" : v.status.replace("_", " ")}
                      </Badge>
                    </div>
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
              {canReview && (
                <>
                  <Textarea
                    label="Review notes (optional for approval, recommended for rejection)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Explain why this was rejected or any admin notes…"
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button disabled={busy} onClick={() => review("APPROVED")}>
                      Approve
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => review("REJECTED")}>
                      Reject
                    </Button>
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-2 border-t border-card-border pt-4">
                {canHide && (
                  <Button variant="outline" disabled={busy} onClick={() => mutate("hide")}>
                    Hide from students
                  </Button>
                )}
                {canUnhide && (
                  <Button variant="outline" disabled={busy} onClick={() => mutate("unhide")}>
                    Unhide
                  </Button>
                )}
                {canRestore && (
                  <Button disabled={busy} onClick={() => mutate("restore")}>
                    Restore
                  </Button>
                )}
                {canDelete && (
                  <Button variant="danger" disabled={busy} onClick={() => mutate("delete")}>
                    Delete
                  </Button>
                )}
              </div>
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
