"use client";

import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { useCallback, useEffect, useMemo, useState } from "react";

type Stage = {
  id: string;
  nameEn: string;
  nameAr?: string | null;
  nameKu?: string | null;
  nameTr?: string | null;
};

type CourseOpt = {
  id: string;
  titleEn: string;
  titleAr?: string | null;
  price: number;
  currency: string;
  stageId: string | null;
  status: string;
};

type Group = {
  id: string;
  titleEn: string;
  titleAr?: string | null;
  titleKu?: string | null;
  titleTr?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  coverKey?: string | null;
  stageId: string;
  isActive: boolean;
  sortOrder: number;
  courseCount: number;
  totalPrice: number;
  currency: string;
  stage?: Stage | null;
  items: { courseId: string; sortOrder: number; course: CourseOpt }[];
};

const emptyForm = {
  titleEn: "",
  titleAr: "",
  titleKu: "",
  titleTr: "",
  description: "",
  stageId: "",
  sortOrder: "0",
  isActive: true,
  courseIds: [] as string[],
  coverFile: null as File | null,
  coverUrl: "" as string,
  coverKey: "" as string,
};

export function CourseGroupsClient() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [courses, setCourses] = useState<CourseOpt[]>([]);
  const [editing, setEditing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(() => {
    setGroups(null);
    fetch("/api/admin/course-groups")
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d) => setGroups(d.groups || []));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    fetch("/api/admin/courses/tree")
      .then((r) => (r.ok ? r.json() : { stages: [] }))
      .then((d) => setStages(d.stages || []));
    fetch("/api/admin/teacher-courses?status=APPROVED")
      .then((r) => (r.ok ? r.json() : { courses: [] }))
      .then((d) =>
        setCourses(
          (d.courses || []).map(
            (c: {
              id: string;
              titleEn: string;
              titleAr?: string | null;
              price: number;
              currency: string;
              stageId?: string | null;
              stage?: { id?: string };
              status: string;
            }) => ({
              id: c.id,
              titleEn: c.titleEn,
              titleAr: c.titleAr,
              price: c.price,
              currency: c.currency,
              stageId: c.stageId ?? c.stage?.id ?? null,
              status: c.status,
            })
          )
        )
      );
  }, []);

  const stageCourses = useMemo(
    () => courses.filter((c) => c.stageId === form.stageId),
    [courses, form.stageId]
  );

  const totalPreview = useMemo(() => {
    const selected = stageCourses.filter((c) => form.courseIds.includes(c.id));
    const total = selected.reduce((s, c) => s + (c.price || 0), 0);
    return {
      total: Math.round(total * 100) / 100,
      currency: selected[0]?.currency ?? "IQD",
      count: selected.length,
    };
  }, [stageCourses, form.courseIds]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, stageId: stages[0]?.id ?? "" });
    setCreating(true);
  }

  function openEdit(g: Group) {
    setCreating(false);
    setEditing(g);
    setForm({
      titleEn: g.titleEn,
      titleAr: g.titleAr ?? "",
      titleKu: g.titleKu ?? "",
      titleTr: g.titleTr ?? "",
      description: g.description ?? "",
      stageId: g.stageId,
      sortOrder: String(g.sortOrder ?? 0),
      isActive: g.isActive,
      courseIds: g.items.map((i) => i.courseId),
      coverFile: null,
      coverUrl: g.coverUrl ?? "",
      coverKey: g.coverKey ?? "",
    });
  }

  function toggleCourse(id: string) {
    setForm((f) => ({
      ...f,
      courseIds: f.courseIds.includes(id)
        ? f.courseIds.filter((x) => x !== id)
        : [...f.courseIds, id],
    }));
  }

  function moveCourse(id: string, dir: -1 | 1) {
    setForm((f) => {
      const idx = f.courseIds.indexOf(id);
      if (idx < 0) return f;
      const next = [...f.courseIds];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return f;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...f, courseIds: next };
    });
  }

  async function uploadCoverIfNeeded(): Promise<{ coverKey?: string; coverUrl?: string }> {
    if (!form.coverFile) {
      return {
        coverKey: form.coverKey || undefined,
        coverUrl: form.coverUrl || undefined,
      };
    }
    const file = form.coverFile;
    const presign = await fetch("/api/admin/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
        category: "image",
        folder: "course-groups",
      }),
    });
    if (!presign.ok) throw new Error((await presign.json()).error || "Upload failed");
    const { uploadUrl, key, publicUrl } = await presign.json();
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!put.ok) throw new Error("Cover upload failed");
    const coverUrl =
      (typeof publicUrl === "string" && publicUrl.trim().startsWith("http")
        ? publicUrl.trim()
        : null) ||
      (typeof publicUrl === "string" && publicUrl.trim().startsWith("/api/media/")
        ? publicUrl.trim()
        : null) ||
      `/api/media/${String(key)
        .split("/")
        .map((p: string) => encodeURIComponent(p))
        .join("/")}`;
    return { coverKey: key, coverUrl };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titleEn.trim() || !form.stageId || form.courseIds.length === 0) {
      toast("Title, stage, and at least one course are required", "error");
      return;
    }
    setBusy(true);
    try {
      const cover = await uploadCoverIfNeeded();
      const body = {
        titleEn: form.titleEn.trim(),
        titleAr: form.titleAr.trim() || undefined,
        titleKu: form.titleKu.trim() || undefined,
        titleTr: form.titleTr.trim() || undefined,
        description: form.description.trim() || undefined,
        stageId: form.stageId,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
        courseIds: form.courseIds,
        ...cover,
      };

      const res = editing
        ? await fetch(`/api/admin/course-groups/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/course-groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Save failed");
      }
      toast(editing ? "Group updated" : "Group created");
      setCreating(false);
      setEditing(null);
      setForm(emptyForm);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(g: Group) {
    if (!confirm(`Delete group "${g.titleEn}"?`)) return;
    const res = await fetch(`/api/admin/course-groups/${g.id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Group deleted");
      load();
    } else {
      toast("Failed", "error");
    }
  }

  async function toggleActive(g: Group) {
    const res = await fetch(`/api/admin/course-groups/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !g.isActive }),
    });
    if (res.ok) {
      toast(g.isActive ? "Group hidden" : "Group is live");
      load();
    } else {
      toast("Failed", "error");
    }
  }

  const modalOpen = creating || !!editing;

  return (
    <div>
      <PageHeader
        title="Course Groups"
        description="Stage packages shown on Home — price is the sum of member courses"
        actions={<Button onClick={openCreate}>New Group</Button>}
      />

      <div className="mt-6">
        {groups === null ? (
          <SkeletonRows rows={3} />
        ) : groups.length === 0 ? (
          <EmptyState title="No course groups yet" />
        ) : (
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <Card key={g.id} className="overflow-hidden p-0">
                {g.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.coverUrl}
                    alt={g.titleEn}
                    className="h-36 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-36 items-center justify-center bg-surface-2 text-sm text-muted">
                    No cover
                  </div>
                )}
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{g.titleEn}</p>
                      <p className="text-xs text-muted">
                        {g.stage?.nameEn || "—"} · {g.courseCount} courses
                      </p>
                    </div>
                    <Badge status={g.isActive ? "APPROVED" : "SUSPENDED"}>
                      {g.isActive ? "Live" : "Hidden"}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium">
                    {g.totalPrice.toLocaleString()} {g.currency}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => openEdit(g)}>
                      Edit
                    </Button>
                    <Button variant="outline" onClick={() => toggleActive(g)}>
                      {g.isActive ? "Hide" : "Publish"}
                    </Button>
                    <Button variant="danger" onClick={() => remove(g)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <Modal
          open
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          title={editing ? "Edit Course Group" : "New Course Group"}
        >
          <form onSubmit={save} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div>
              <label className="mb-1 block text-sm text-muted">Cover image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setForm((f) => ({ ...f, coverFile: e.target.files?.[0] ?? null }))
                }
                className="block w-full text-sm"
              />
              {(form.coverUrl || form.coverFile) && (
                <p className="mt-1 text-xs text-muted">
                  {form.coverFile ? form.coverFile.name : "Current cover kept if unchanged"}
                </p>
              )}
            </div>

            <Input
              label="Title (English)"
              value={form.titleEn}
              onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))}
              required
            />
            <Input
              label="Title (Arabic)"
              value={form.titleAr}
              onChange={(e) => setForm((f) => ({ ...f, titleAr: e.target.value }))}
            />
            <Input
              label="Title (Kurdish)"
              value={form.titleKu}
              onChange={(e) => setForm((f) => ({ ...f, titleKu: e.target.value }))}
            />
            <Input
              label="Title (Turkish)"
              value={form.titleTr}
              onChange={(e) => setForm((f) => ({ ...f, titleTr: e.target.value }))}
            />
            <div>
              <label className="mb-1 block text-sm text-muted">Description</label>
              <textarea
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-muted">Educational stage</label>
              <select
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                value={form.stageId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    stageId: e.target.value,
                    courseIds: [],
                  }))
                }
                required
              >
                <option value="">Select stage…</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameEn}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Sort order"
              value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
            />

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Active on Home
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Courses in this stage</p>
                <p className="text-xs text-muted">
                  {totalPreview.count} selected · {totalPreview.total.toLocaleString()}{" "}
                  {totalPreview.currency}
                </p>
              </div>
              {!form.stageId ? (
                <p className="text-sm text-muted">Select a stage first</p>
              ) : stageCourses.length === 0 ? (
                <p className="text-sm text-muted">No approved courses for this stage</p>
              ) : (
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
                  {stageCourses.map((c) => {
                    const selected = form.courseIds.includes(c.id);
                    const order = form.courseIds.indexOf(c.id);
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleCourse(c.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{c.titleEn}</p>
                          <p className="text-xs text-muted">
                            {c.price.toLocaleString()} {c.currency}
                          </p>
                        </div>
                        {selected && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted">#{order + 1}</span>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => moveCourse(c.id, -1)}
                            >
                              ↑
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => moveCourse(c.id, 1)}
                            >
                              ↓
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save changes" : "Create group"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
