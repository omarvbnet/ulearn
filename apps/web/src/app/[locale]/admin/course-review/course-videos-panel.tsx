"use client";

import { Badge, Button, Card } from "@/components/ui";
import { AdminVideoFilters } from "@/components/admin-video-filters";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { useCallback, useEffect, useMemo, useState } from "react";

type CourseLessonVideo = {
  id: string;
  title: string;
  fileUrl: string | null;
  durationSec: number | null;
  isHidden: boolean;
  deletedAt: string | null;
  createdAt: string;
  course: {
    id: string;
    titleEn: string;
    status: string;
    teacher: {
      level: string;
      user: { fullLegalName: string | null; phone: string };
    };
  };
  _count: { likes: number; favorites: number };
};

export function CourseVideosPanel() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [visibility, setVisibility] = useState("visible");
  const [sort, setSort] = useState("newest");
  const [courseStatus, setCourseStatus] = useState("");
  const [lessons, setLessons] = useState<CourseLessonVideo[] | null>(null);
  const [selected, setSelected] = useState<CourseLessonVideo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("visibility", visibility);
    if (debouncedQ) params.set("q", debouncedQ);
    if (sort) params.set("sort", sort);
    if (courseStatus) params.set("courseStatus", courseStatus);
    return params.toString();
  }, [visibility, debouncedQ, sort, courseStatus]);

  const load = useCallback(() => {
    setLessons(null);
    fetch(`/api/admin/course-lessons?${queryString}`)
      .then((r) => (r.ok ? r.json() : { lessons: [] }))
      .then((d) => setLessons(d.lessons || []));
  }, [queryString]);

  useEffect(load, [load]);

  async function mutate(action: "hide" | "unhide" | "restore" | "delete") {
    if (!selected) return;
    if (action === "delete" && !confirm(`Delete "${selected.title}"? Teachers will be notified.`)) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/admin/course-lessons/${selected.id}`, {
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

  return (
    <div>
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
          { value: "title", label: "Title A–Z" },
        ]}
        placeholder="Search lesson, course, teacher, phone…"
      />

      <div className="mt-3">
        <label className="mb-1 block text-sm text-muted">Course status</label>
        <select
          className="input w-full max-w-xs"
          value={courseStatus}
          onChange={(e) => setCourseStatus(e.target.value)}
        >
          <option value="">All courses</option>
          <option value="APPROVED">Live courses only</option>
          <option value="PENDING_REVIEW">Pending courses</option>
          <option value="REJECTED">Rejected courses</option>
          <option value="CLOSED">Closed courses</option>
        </select>
      </div>

      <div className="mt-6">
        {lessons === null ? (
          <SkeletonRows rows={4} />
        ) : lessons.length === 0 ? (
          <EmptyState title="No course videos" hint="Try another filter or search term." />
        ) : (
          <div className="stagger space-y-3">
            {lessons.map((lesson) => (
              <Card
                key={lesson.id}
                className="card-hover cursor-pointer p-4"
                onClick={() => setSelected(lesson)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{lesson.title}</p>
                    <p className="mt-1 text-sm text-muted">{lesson.course.titleEn}</p>
                    <p className="mt-1 text-xs text-muted">
                      {lesson.course.teacher.user.fullLegalName} ·{" "}
                      <span dir="ltr">{lesson.course.teacher.user.phone}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge status={lesson.course.status === "APPROVED" ? "APPROVED" : "PENDING"}>
                      {lesson.course.status.replace("_", " ")}
                    </Badge>
                    {lesson.deletedAt ? (
                      <Badge status="SUSPENDED">Deleted</Badge>
                    ) : lesson.isHidden ? (
                      <Badge status="PENDING">Hidden</Badge>
                    ) : (
                      <Badge status="APPROVED">Visible</Badge>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {lesson._count.likes} likes · {lesson._count.favorites} saves
                  {lesson.durationSec ? ` · ${Math.round(lesson.durationSec / 60)} min` : ""} ·{" "}
                  {new Date(lesson.createdAt).toLocaleString()}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <Modal open onClose={() => setSelected(null)} title={selected.title} wide>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="aspect-video overflow-hidden rounded-xl bg-black">
              {selected.fileUrl ? (
                <video src={selected.fileUrl} controls className="h-full w-full object-contain" playsInline />
              ) : (
                <div className="flex h-full items-center justify-center text-muted">No preview</div>
              )}
            </div>
            <div className="space-y-4 text-sm">
              <p>
                <span className="text-muted">Course:</span> {selected.course.titleEn}
              </p>
              <p>
                <span className="text-muted">Teacher:</span>{" "}
                {selected.course.teacher.user.fullLegalName} ({selected.course.teacher.level.replace("_", " ")})
              </p>
              <p className="text-xs text-muted">
                Uploaded {new Date(selected.createdAt).toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-2 border-t border-card-border pt-4">
                {!selected.deletedAt && !selected.isHidden && (
                  <Button variant="outline" disabled={busy} onClick={() => mutate("hide")}>
                    Hide from students
                  </Button>
                )}
                {!selected.deletedAt && selected.isHidden && (
                  <Button variant="outline" disabled={busy} onClick={() => mutate("unhide")}>
                    Unhide
                  </Button>
                )}
                {selected.deletedAt && (
                  <Button disabled={busy} onClick={() => mutate("restore")}>
                    Restore
                  </Button>
                )}
                {!selected.deletedAt && (
                  <Button variant="danger" disabled={busy} onClick={() => mutate("delete")}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
