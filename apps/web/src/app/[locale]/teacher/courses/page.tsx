"use client";

import { Badge, Button, Card, Input, PageHeader, Select, StatCard, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { cn } from "@/lib/utils";
import { captureVideoThumbnail } from "@/lib/video-thumbnail";
import { fetchWatermarkConfig, processVideoForUpload, uploadVideoDirect } from "@/lib/video-process";
import { CourseWizard } from "./course-wizard";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

const WhiteboardStudio = dynamic(
  () => import("@/components/whiteboard/whiteboard-studio"),
  { ssr: false, loading: () => <p className="text-sm text-muted">Loading whiteboard studio…</p> }
);

type Lesson = {
  id: string;
  title: string;
  durationSec: number | null;
  isFreePreview: boolean;
  isInterview?: boolean;
  lessonType?: "VIDEO" | "WHITEBOARD";
  whiteboardAssetId?: string | null;
  sectionId?: string | null;
};

type CourseSection = { id: string; title: string; sortOrder?: number };

type Course = {
  id: string;
  titleEn: string;
  description: string | null;
  price: number;
  currency: string;
  status: string;
  reviewNotes: string | null;
  closedByLevel: boolean;
  thumbnail?: string | null;
  usesSections?: boolean;
  sections?: CourseSection[];
  stage: { nameEn: string };
  subject: { nameEn: string };
  lessons: Lesson[];
  _count: { purchases: number; quizzes: number };
};

type Meta = {
  level: string;
  isActive: boolean;
  subjects: { id: string; nameEn: string; stageId: string | null }[];
  stages: { id: string; nameEn: string }[];
  earnings: {
    sales: number;
    gross: number;
    teacherRevenue: number;
    platformRevenue: number;
    currency: string;
  };
  whiteboardLessonsEnabled?: boolean;
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "PENDING",
  PENDING_REVIEW: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "SUSPENDED",
  CLOSED: "SUSPENDED",
};

export default function TeacherCoursesPage() {
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [wizardCourseId, setWizardCourseId] = useState<string | undefined>();
  const [lessonsFor, setLessonsFor] = useState<Course | null>(null);
  const [quizzesFor, setQuizzesFor] = useState<Course | null>(null);
  const [editFor, setEditFor] = useState<Course | null>(null);

  const load = useCallback(() => {
    fetch("/api/teacher/courses")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCourses(d.courses || []);
        setMeta({
          level: d.level,
          isActive: d.isActive,
          subjects: d.subjects || [],
          stages: d.stages || [],
          earnings: d.earnings,
          whiteboardLessonsEnabled: d.features?.whiteboardLessonsEnabled !== false,
        });
      });
  }, []);

  useEffect(load, [load]);

  async function remove(id: string) {
    if (!window.confirm("Delete this course?")) return;
    const res = await fetch(`/api/teacher/courses/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Course deleted");
      load();
    }
  }

  return (
    <div>
      <PageHeader
        title="My Courses"
        description="Create priced courses for your students — every course is reviewed by an admin before it goes live"
        actions={
          meta?.isActive ? (
            <Button
              onClick={() => {
                if (!meta.subjects.length) {
                  toast("Set your teaching specialties first (up to 3)", "error");
                  return;
                }
                setWizardCourseId(undefined);
                setShowCreate(true);
              }}
            >
              + New Course
            </Button>
          ) : undefined
        }
      />

      {meta && <TeacherSpecialtiesPanel onChanged={load} toast={toast} />}

      {meta && (
        <>
          {meta.level === "NEEDS_IMPROVEMENT" && (
            <Card className="mb-5 border-danger/40 bg-danger/10">
              <p className="text-sm">
                Your level is <strong>Needs improvement</strong> — all your courses are
                paused until your student evaluations bring you back to Good or higher.
              </p>
            </Card>
          )}
          {!meta.isActive && (
            <Card className="mb-5 border-danger/40 bg-danger/10">
              <p className="text-sm">
                Your teacher account is blocked. Contact the administration.
              </p>
            </Card>
          )}
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Level" value={meta.level.replace(/_/g, " ")} />
            <StatCard label="Sales" value={String(meta.earnings.sales)} />
            <StatCard
              label="Your revenue"
              value={`${meta.earnings.teacherRevenue} ${meta.earnings.currency}`}
            />
            <StatCard
              label="Gross"
              value={`${meta.earnings.gross} ${meta.earnings.currency}`}
            />
          </div>
        </>
      )}

      {courses === null ? (
        <SkeletonRows rows={3} />
      ) : courses.length === 0 ? (
        <EmptyState
          title="No courses yet"
          hint="Create your first course — it will be published after admin review."
        />
      ) : (
        <div className="stagger space-y-3">
          {courses.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{c.titleEn}</p>
                  <p className="mt-1 text-sm text-muted">
                    {c.subject.nameEn} · {c.stage.nameEn} · {c.lessons.length} lessons ·{" "}
                    {c._count.quizzes ?? 0}/2 quizzes · {c._count.purchases} sales
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-accent">
                    {c.price} {c.currency}
                  </span>
                  <Badge status={STATUS_BADGE[c.status] ?? "PENDING"}>
                    {c.closedByLevel ? "PAUSED (level)" : c.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
              {c.status === "REJECTED" && c.reviewNotes && (
                <p className="mt-2 rounded-lg bg-danger/10 p-2 text-sm text-danger">
                  Admin: {c.reviewNotes}
                </p>
              )}
              {c.status === "DRAFT" && (
                <p className="mt-2 rounded-lg bg-sky-500/10 p-2 text-sm text-sky-200">
                  Draft — finish the wizard checklist, then submit for review.
                </p>
              )}
              {c._count.quizzes < 2 && c.status !== "DRAFT" && (
                <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-sm text-amber-200">
                  Add at least 2 quizzes before this course can be approved.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {(c.status === "DRAFT" || c.status === "REJECTED") && (
                  <Button
                    className="!px-3 !py-1.5 text-xs"
                    onClick={() => {
                      setWizardCourseId(c.id);
                      setShowCreate(true);
                    }}
                  >
                    {c.status === "DRAFT" ? "Continue wizard" : "Fix & resubmit"}
                  </Button>
                )}
                {c.status !== "APPROVED" && c.status !== "DRAFT" && (
                  <p className="w-full rounded-lg bg-amber-500/10 p-2 text-xs text-amber-200">
                    Editing is allowed, but videos and PDFs stay hidden until admin approval.
                  </p>
                )}
                <Button
                  variant="outline"
                  className="!px-3 !py-1.5 text-xs"
                  onClick={() => setEditFor(c)}
                >
                  Edit Course
                </Button>
                <Button
                  variant="outline"
                  className="!px-3 !py-1.5 text-xs"
                  onClick={() => setLessonsFor(c)}
                >
                  Manage Lessons
                </Button>
                <Button
                  variant="outline"
                  className="!px-3 !py-1.5 text-xs"
                  onClick={() => setQuizzesFor(c)}
                >
                  Manage Quizzes ({c._count.quizzes ?? 0})
                </Button>
                <Button
                  variant="danger"
                  className="!px-3 !py-1.5 text-xs"
                  onClick={() => remove(c.id)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && meta && (
        <CourseWizard
          meta={meta}
          courseId={wizardCourseId}
          onClose={() => {
            setShowCreate(false);
            setWizardCourseId(undefined);
          }}
          onDone={() => {
            setShowCreate(false);
            setWizardCourseId(undefined);
            load();
          }}
        />
      )}

      {editFor && (
        <EditCourseModal
          course={editFor}
          onClose={() => setEditFor(null)}
          onDone={() => { setEditFor(null); load(); }}
          toast={toast}
        />
      )}

      {lessonsFor && (
        <LessonsModal
          course={lessonsFor}
          whiteboardLessonsEnabled={meta?.whiteboardLessonsEnabled !== false}
          onClose={() => setLessonsFor(null)}
          onChanged={load}
          toast={toast}
        />
      )}

      {quizzesFor && (
        <QuizzesModal
          course={quizzesFor}
          onClose={() => setQuizzesFor(null)}
          onChanged={load}
          toast={toast}
        />
      )}
    </div>
  );
}

function TeacherSpecialtiesPanel({
  onChanged,
  toast,
}: {
  onChanged: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [available, setAvailable] = useState<{ id: string; nameEn: string }[]>([]);
  const max = 3;

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/profile/teacher")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setSelected((d.specialties ?? []).map((s: { id: string }) => s.id));
        setAvailable(d.available ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= max) return prev;
      return [...prev, id];
    });
  }

  async function save() {
    if (selected.length === 0) {
      toast("Select at least one specialty", "error");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/profile/teacher", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectIds: selected }),
    });
    setSaving(false);
    if (res.ok) {
      toast("Specialties saved");
      load();
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Could not save specialties", "error");
    }
  }

  if (loading) return <div className="mb-5"><SkeletonRows rows={1} /></div>;

  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Teaching specialties</h2>
          <p className="mt-1 text-sm text-muted">
            Choose up to {max} subjects you teach (e.g. Mathematics, Chemistry). Required before
            creating courses.
          </p>
        </div>
        <Button variant="outline" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save specialties"}
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {available.map((s) => {
          const active = selected.includes(s.id);
          const disabled = !active && selected.length >= max;
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(s.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition",
                active
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-card-border text-muted hover:border-accent/40",
                disabled && "opacity-40"
              )}
            >
              {s.nameEn}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        {selected.length} of {max} selected
      </p>
    </Card>
  );
}

function EditCourseModal({ course, onClose, onDone, toast }: {
  course: Course;
  onClose: () => void;
  onDone: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [saving, setSaving] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    titleEn: course.titleEn,
    description: course.description ?? "",
    price: String(course.price),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      let thumbnail = course.thumbnail ?? undefined;
      if (coverFile) {
        const presign = await fetch("/api/admin/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: coverFile.name,
            contentType: coverFile.type || "image/jpeg",
            size: coverFile.size,
            category: "image",
            folder: "teacher-covers",
          }),
        }).then((r) => r.json());
        if (!presign.uploadUrl) throw new Error("Cover upload failed");
        await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": coverFile.type || "image/jpeg" },
          body: coverFile,
        });
        thumbnail = presign.publicUrl ?? thumbnail;
      }

      const res = await fetch(`/api/teacher/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleEn: form.titleEn,
          description: form.description || undefined,
          price: Number(form.price),
          ...(thumbnail ? { thumbnail } : {}),
        }),
      });
      if (res.ok) {
        toast("Course updated — sent back for review if it was live");
        onDone();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.error || "Failed to update course", "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update course", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit — ${course.titleEn}`}>
      <form onSubmit={submit} className="space-y-4">
        <Input
          label="Title (English)"
          value={form.titleEn}
          onChange={(e) => setForm({ ...form, titleEn: e.target.value })}
          required
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <Input
          label="Course price (IQD)"
          type="number"
          min="0"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          required
        />
        <div className="space-y-2">
          <label className="text-sm font-medium">Course cover</label>
          {(coverFile || course.thumbnail) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverFile ? URL.createObjectURL(coverFile) : (course.thumbnail as string)}
              alt=""
              className="h-36 w-full rounded-lg object-cover"
            />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            className="input file:me-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-accent"
          />
        </div>
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Modal>
  );
}

function LessonsModal({ course, whiteboardLessonsEnabled = true, onClose, onChanged, toast }: {
  course: Course;
  whiteboardLessonsEnabled?: boolean;
  onClose: () => void;
  onChanged: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [lessons, setLessons] = useState<Lesson[]>(course.lessons);
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<CourseSection[]>(course.sections ?? []);
  const [sectionId, setSectionId] = useState(course.sections?.[0]?.id ?? "");
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [lessonType, setLessonType] = useState<"VIDEO" | "WHITEBOARD">("VIDEO");
  const [showWbStudio, setShowWbStudio] = useState(false);
  const [editWb, setEditWb] = useState<{ lessonId: string; whiteboardId: string; title: string } | null>(
    null
  );
  const [file, setFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(false);
  const [asInterview, setAsInterview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  async function uploadVideo(videoFile: File) {
    const watermark = await fetchWatermarkConfig();
    const processed = await processVideoForUpload(videoFile, {
      watermark,
      courseName: course.titleEn,
      onProgress: setProgress,
    });

    let thumbnailKey: string | undefined;
    let thumbnailUrl: string | undefined;
    let durationSec: number | undefined;

    try {
      const captured = await captureVideoThumbnail(processed.file);
      durationSec = captured.durationSec;
      const thumbName = `${videoFile.name.replace(/\.[^.]+$/, "")}-cover.jpg`;
      const thumbPresign = await fetch("/api/admin/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: thumbName,
          contentType: "image/jpeg",
          size: captured.blob.size,
          category: "image",
          folder: "teacher-courses/covers",
        }),
      });
      if (thumbPresign.ok) {
        const thumb = await thumbPresign.json();
        await fetch(thumb.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: captured.blob,
        });
        thumbnailKey = thumb.key;
        thumbnailUrl = thumb.publicUrl;
      }
    } catch {
      // Procedural covers still render on mobile when no thumbnail is stored.
    }

    setProgress(0);
    const uploaded = await uploadVideoDirect({
      file: processed.file,
      courseId: course.id,
      scope: "STORE_COURSE",
      durationSec,
      onProgress: setProgress,
    });
    return {
      fileKey: uploaded.objectKey,
      videoAssetId: uploaded.videoId,
      thumbnailKey,
      thumbnailUrl,
      durationSec,
    };
  }

  async function addSection() {
    if (!newSectionTitle.trim()) {
      toast("Enter a section title", "error");
      return;
    }
    const res = await fetch(`/api/teacher/courses/${course.id}/sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newSectionTitle.trim() }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Could not add section", "error");
      return;
    }
    const { section } = await res.json();
    setSections((prev) => [...prev, section]);
    setSectionId(section.id);
    setNewSectionTitle("");
    toast("Section added");
    onChanged();
  }

  async function addLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (course.usesSections && !sectionId) {
      toast("Add a section first, then add videos or whiteboard lessons inside it.", "error");
      return;
    }
    if (lessonType === "WHITEBOARD") {
      if (!whiteboardLessonsEnabled) {
        toast("Whiteboard lessons are disabled by admin", "error");
        return;
      }
      setShowWbStudio(true);
      return;
    }
    setUploading(true);
    setProgress(0);

    try {
      let fileKey: string | undefined;
      let thumbnailKey: string | undefined;
      let thumbnailUrl: string | undefined;
      let durationSec: number | undefined;
      let pdfFileKey: string | undefined;
      let pdfFileUrl: string | undefined;
      let videoAssetId: string | undefined;

      if (file) {
        const uploaded = await uploadVideo(file);
        fileKey = uploaded.fileKey;
        videoAssetId = uploaded.videoAssetId;
        thumbnailKey = uploaded.thumbnailKey;
        thumbnailUrl = uploaded.thumbnailUrl;
        durationSec = uploaded.durationSec;
      }

      if (pdfFile) {
        const presign = await fetch("/api/admin/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: pdfFile.name,
            contentType: "application/pdf",
            size: pdfFile.size,
            category: "document",
            folder: "teacher-course-pdfs",
          }),
        });
        if (!presign.ok) throw new Error((await presign.json()).error);
        const { uploadUrl, key, publicUrl } = await presign.json();
        await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: pdfFile,
        });
        pdfFileKey = key;
        pdfFileUrl = publicUrl;
      }

      const res = await fetch(`/api/teacher/courses/${course.id}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          fileKey,
          videoAssetId,
          thumbnailKey,
          thumbnailUrl,
          durationSec,
          sortOrder: asInterview ? 0 : lessons.length,
          isFreePreview: asInterview || preview,
          isInterview: asInterview,
          ...(course.usesSections && sectionId ? { sectionId } : {}),
          ...(pdfFileKey
            ? {
                pdfFileKey,
                pdfFileUrl,
                pdfMimeType: "application/pdf",
                pdfTitle: `${title.trim()} — PDF`,
              }
            : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save lesson");
      }
      const { lesson } = await res.json();
      const next = asInterview
        ? [lesson, ...lessons.map((l) => ({ ...l, isInterview: false }))]
        : [...lessons, lesson];
      setLessons(next);
      setTitle("");
      setFile(null);
      setPdfFile(null);
      setPreview(false);
      setAsInterview(false);
      toast(thumbnailUrl ? "Lesson added with smart cover" : "Lesson added");
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setUploading(false);
    }
  }

  async function removeLesson(lessonId: string) {
    const res = await fetch(`/api/teacher/courses/${course.id}/lessons`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId }),
    });
    if (res.ok) {
      setLessons(lessons.filter((l) => l.id !== lessonId));
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Could not remove lesson", "error");
    }
  }

  async function setLessonAccess(lesson: Lesson, makeFree: boolean) {
    if (lesson.isInterview && !makeFree) {
      toast("The interview video must remain free", "error");
      return;
    }
    if (lesson.isFreePreview === makeFree) return;
    const freeCount = lessons.filter((l) => l.isFreePreview).length;
    if (!makeFree && lesson.isFreePreview && freeCount <= 2) {
      toast("Keep at least 2 free preview videos", "error");
      return;
    }
    if (makeFree && !lesson.isFreePreview && freeCount >= 2) {
      toast("A course can have at most 2 free preview videos", "error");
      return;
    }
    const res = await fetch(`/api/teacher/courses/${course.id}/lessons/${lesson.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFreePreview: makeFree }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Could not update access", "error");
      return;
    }
    setLessons(
      lessons.map((l) => (l.id === lesson.id ? { ...l, isFreePreview: makeFree } : l))
    );
    toast(makeFree ? "Marked as free preview" : "Marked as paid");
    onChanged();
  }

  async function renameLesson(lesson: Lesson) {
    const next = window.prompt("Rename lesson", lesson.title);
    if (!next || !next.trim() || next.trim() === lesson.title) return;
    const res = await fetch(`/api/teacher/courses/${course.id}/lessons/${lesson.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next.trim() }),
    });
    if (!res.ok) {
      toast("Rename failed", "error");
      return;
    }
    setLessons(lessons.map((l) => (l.id === lesson.id ? { ...l, title: next.trim() } : l)));
    onChanged();
  }

  async function moveLesson(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= lessons.length) return;
    const next = [...lessons];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    // Keep interview at top when present
    next.sort((a, b) => Number(!!b.isInterview) - Number(!!a.isInterview));
    setLessons(next);
    const res = await fetch(`/api/teacher/courses/${course.id}/lessons/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonIds: next.map((l) => l.id) }),
    });
    if (!res.ok) {
      toast("Reorder failed", "error");
      setLessons(lessons);
      return;
    }
    onChanged();
  }

  async function replaceVideo(lessonId: string, videoFile: File) {
    setReplacingId(lessonId);
    setProgress(0);
    try {
      const uploaded = await uploadVideo(videoFile);
      const res = await fetch(`/api/teacher/courses/${course.id}/lessons/${lessonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileKey: uploaded.fileKey,
          videoAssetId: uploaded.videoAssetId,
          thumbnailKey: uploaded.thumbnailKey,
          thumbnailUrl: uploaded.thumbnailUrl,
          durationSec: uploaded.durationSec,
        }),
      });
      if (!res.ok) throw new Error("Replace failed");
      toast("Video replaced");
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Replace failed", "error");
    } finally {
      setReplacingId(null);
      setProgress(0);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Lessons — ${course.titleEn}`} wide>
      <div className="space-y-4">
        {lessons.length > 0 && (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {lessons.map((l, i) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-card-border px-3 py-2 text-sm"
              >
                <span>
                  {i + 1}. {l.title}
                  {course.usesSections && l.sectionId && (
                    <span className="ms-2 text-xs text-muted">
                      {sections.find((s) => s.id === l.sectionId)?.title ?? "section"}
                    </span>
                  )}
                  {l.lessonType === "WHITEBOARD" && (
                    <span className="ms-2 text-xs text-accent">whiteboard</span>
                  )}
                  {l.isInterview && (
                    <span className="ms-2 text-xs text-accent">interview</span>
                  )}
                  {l.isFreePreview && !l.isInterview && (
                    <span className="ms-2 text-xs text-accent">free preview</span>
                  )}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {!l.isInterview && (
                    <>
                      <button
                        className={cn(
                          "rounded px-2 py-0.5 text-xs",
                          l.isFreePreview ? "bg-accent/20 text-accent" : "text-muted hover:underline"
                        )}
                        onClick={() => setLessonAccess(l, true)}
                      >
                        Free
                      </button>
                      <button
                        className={cn(
                          "rounded px-2 py-0.5 text-xs",
                          !l.isFreePreview ? "bg-accent/20 text-accent" : "text-muted hover:underline"
                        )}
                        onClick={() => setLessonAccess(l, false)}
                      >
                        Paid
                      </button>
                    </>
                  )}
                  <button className="text-xs text-muted hover:underline" onClick={() => moveLesson(i, -1)} disabled={i === 0}>
                    Up
                  </button>
                  <button className="text-xs text-muted hover:underline" onClick={() => moveLesson(i, 1)} disabled={i === lessons.length - 1}>
                    Down
                  </button>
                  <button className="text-xs text-muted hover:underline" onClick={() => renameLesson(l)}>
                    Rename
                  </button>
                  {l.lessonType === "WHITEBOARD" && l.whiteboardAssetId && (
                    <button
                      className="text-xs text-accent hover:underline"
                      onClick={() =>
                        setEditWb({
                          lessonId: l.id,
                          whiteboardId: l.whiteboardAssetId!,
                          title: l.title,
                        })
                      }
                    >
                      Edit board
                    </button>
                  )}
                  {l.lessonType !== "WHITEBOARD" && (
                  <label className="cursor-pointer text-xs text-accent hover:underline">
                    {replacingId === l.id ? `Replacing… ${progress}%` : "Replace video"}
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      disabled={!!replacingId}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void replaceVideo(l.id, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  )}
                  <button className="text-danger hover:underline" onClick={() => removeLesson(l.id)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {editWb ? (
          <WhiteboardStudio
            courseId={course.id}
            lessonId={editWb.lessonId}
            whiteboardId={editWb.whiteboardId}
            initialTitle={editWb.title}
            onCancel={() => setEditWb(null)}
            onPublished={(result) => {
              setEditWb(null);
              toast(
                result?.pendingReview
                  ? "Whiteboard edit submitted for admin review"
                  : "Whiteboard lesson updated",
                "success"
              );
              onChanged();
            }}
          />
        ) : showWbStudio ? (
          <WhiteboardStudio
            courseId={course.id}
            initialTitle={title.trim() || "Whiteboard lesson"}
            sectionId={sectionId || undefined}
            onCancel={() => setShowWbStudio(false)}
            onPublished={() => {
              setShowWbStudio(false);
              setTitle("");
              toast("Whiteboard lesson published", "success");
              onChanged();
              onClose();
            }}
          />
        ) : (
        <form onSubmit={addLesson} className="space-y-3 border-t border-card-border pt-4">
          {course.usesSections && (
            <div className="space-y-2 rounded-xl border border-card-border p-3">
              <p className="text-sm font-medium">Course sections</p>
              <p className="text-xs text-muted">
                Videos and whiteboard lessons must belong to a section.
              </p>
              {sections.length > 0 && (
                <Select
                  label="Section"
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </Select>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label="New section"
                    value={newSectionTitle}
                    onChange={(e) => setNewSectionTitle(e.target.value)}
                    placeholder="e.g. Chapter 1"
                  />
                </div>
                <Button type="button" onClick={addSection} disabled={!newSectionTitle.trim()}>
                  Add
                </Button>
              </div>
            </div>
          )}
          <Input
            label="Lesson title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLessonType("VIDEO")}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm",
                lessonType === "VIDEO" ? "border-accent bg-accent/10 text-accent" : "border-card-border"
              )}
            >
              Video Lesson
            </button>
            {whiteboardLessonsEnabled && (
              <button
                type="button"
                onClick={() => {
                  setLessonType("WHITEBOARD");
                  setAsInterview(false);
                }}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-sm",
                  lessonType === "WHITEBOARD" ? "border-accent bg-accent/10 text-accent" : "border-card-border"
                )}
              >
                Whiteboard Lesson
              </button>
            )}
          </div>
          {lessonType === "VIDEO" && (
            <>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input file:me-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-accent"
          />
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            className="input file:me-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-accent"
          />
          {pdfFile && <p className="text-xs text-muted">PDF: {pdfFile.name}</p>}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={asInterview}
              onChange={(e) => {
                setAsInterview(e.target.checked);
                if (e.target.checked) setPreview(true);
              }}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Interview video (free preview, first position)
          </label>
            </>
          )}
          {lessonType === "WHITEBOARD" && (
            <p className="text-xs text-muted">
              Opens Whiteboard Studio to record mic + drawings into a synchronized lesson package.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={preview || asInterview}
              disabled={asInterview}
              onChange={(e) => setPreview(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Free preview (visible before purchase)
          </label>
          {uploading && progress > 0 && (
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          <Button type="submit" disabled={uploading || !!replacingId || (course.usesSections && !sectionId)} className="w-full">
            {uploading
              ? `Uploading… ${progress}%`
              : lessonType === "WHITEBOARD"
                ? "Open Whiteboard Studio"
                : "Add Lesson"}
          </Button>
        </form>
        )}
      </div>
    </Modal>
  );
}

type CourseQuiz = {
  id: string;
  titleEn: string;
  passPercentage: number;
  maxAttempts: number;
  _count: { questions: number; attempts: number };
};

type QuestionDraft = {
  id: string;
  text: string;
  optA: string;
  optB: string;
  optC: string;
  optD: string;
  correct: string;
  timerEnabled: boolean;
  timeSec: string;
};

function newQuestionDraft(): QuestionDraft {
  return {
    id: crypto.randomUUID(),
    text: "",
    optA: "",
    optB: "",
    optC: "",
    optD: "",
    correct: "A",
    timerEnabled: false,
    timeSec: "60",
  };
}

function QuizzesModal({ course, onClose, onChanged, toast }: {
  course: Course;
  onClose: () => void;
  onChanged: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [quizzes, setQuizzes] = useState<CourseQuiz[] | null>(null);
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<QuestionDraft[]>([newQuestionDraft()]);
  const [saving, setSaving] = useState(false);

  function updateQuestion(id: string, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function addQuestion() {
    setQuestions((prev) => [...prev, newQuestionDraft()]);
  }

  function removeQuestion(id: string) {
    setQuestions((prev) => (prev.length <= 1 ? prev : prev.filter((q) => q.id !== id)));
  }

  function buildQuestionPayloads() {
    const payloads: {
      textEn: string;
      options: Record<string, string>;
      correctKey: string;
      timeLimitSec?: number;
    }[] = [];

    for (const q of questions) {
      if (!q.text.trim()) return null;
      const options: Record<string, string> = {
        A: q.optA.trim(),
        B: q.optB.trim(),
      };
      if (q.optC.trim()) options.C = q.optC.trim();
      if (q.optD.trim()) options.D = q.optD.trim();
      if (!options.A || !options.B) return null;

      const payload: {
        textEn: string;
        options: Record<string, string>;
        correctKey: string;
        timeLimitSec?: number;
      } = {
        textEn: q.text.trim(),
        options,
        correctKey: q.correct,
      };

      if (q.timerEnabled) {
        const sec = parseInt(q.timeSec, 10);
        if (sec > 0) payload.timeLimitSec = sec;
      }

      payloads.push(payload);
    }

    return payloads;
  }

  const loadQuizzes = useCallback(() => {
    setQuizzes(null);
    fetch(`/api/teacher/courses/${course.id}/quizzes`)
      .then((r) => (r.ok ? r.json() : { quizzes: [] }))
      .then((d) => setQuizzes(d.quizzes || []));
  }, [course.id]);

  useEffect(loadQuizzes, [loadQuizzes]);

  async function addQuiz(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const questionPayloads = buildQuestionPayloads();
    if (!questionPayloads?.length) {
      toast("Add at least two answer options (A & B) for each question", "error");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/teacher/courses/${course.id}/quizzes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titleEn: title.trim(),
        questions: questionPayloads,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast("Quiz added");
      setTitle("");
      setQuestions([newQuestionDraft()]);
      loadQuizzes();
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Failed to add quiz", "error");
    }
  }

  async function removeQuiz(quizId: string) {
    const res = await fetch(`/api/teacher/courses/${course.id}/quizzes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId }),
    });
    if (res.ok) {
      setQuizzes((prev) => prev?.filter((q) => q.id !== quizId) ?? []);
      onChanged();
    }
  }

  async function renameQuiz(quiz: CourseQuiz) {
    const next = window.prompt("Rename quiz", quiz.titleEn);
    if (!next || !next.trim() || next.trim() === quiz.titleEn) return;
    const res = await fetch(`/api/teacher/courses/${course.id}/quizzes/${quiz.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titleEn: next.trim() }),
    });
    if (!res.ok) {
      toast("Rename failed", "error");
      return;
    }
    setQuizzes(
      (prev) =>
        prev?.map((q) => (q.id === quiz.id ? { ...q, titleEn: next.trim() } : q)) ?? []
    );
    onChanged();
  }

  return (
    <Modal open onClose={onClose} title={`Quizzes — ${course.titleEn}`} wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Each course needs at least <strong>2 quizzes</strong> before admin approval.
          You have {quizzes?.length ?? 0}/2.
        </p>

        {quizzes === null ? (
          <SkeletonRows rows={2} />
        ) : quizzes.length > 0 ? (
          <ul className="max-h-48 space-y-2 overflow-y-auto">
            {quizzes.map((q, i) => (
              <li
                key={q.id}
                className="flex items-center justify-between rounded-lg border border-card-border px-3 py-2 text-sm"
              >
                <span>
                  {i + 1}. {q.titleEn}{" "}
                  <span className="text-muted">
                    ({q._count.questions} questions · pass {q.passPercentage}%)
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs text-muted hover:underline"
                    onClick={() => renameQuiz(q)}
                  >
                    Rename
                  </button>
                  <button
                    className="text-danger hover:underline"
                    onClick={() => removeQuiz(q.id)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No quizzes yet" />
        )}

        <form onSubmit={addQuiz} className="space-y-4 border-t border-card-border pt-4">
          <p className="text-sm text-muted">
            Add multiple questions per quiz. Enable an optional timer on any question.
          </p>
          <Input
            label="Quiz title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Questions ({questions.length})</h3>
            <Button type="button" variant="outline" className="!px-3 !py-1.5 text-xs" onClick={addQuestion}>
              Add question
            </Button>
          </div>

          {questions.map((q, index) => {
            const correctOptions = ["A", "B", "C", "D"].filter(
              (k) => k === "A" || k === "B" || (k === "C" && q.optC.trim()) || (k === "D" && q.optD.trim())
            );
            return (
              <div key={q.id} className="space-y-3 rounded-xl border border-card-border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Question {index + 1}</p>
                  {questions.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-danger hover:underline"
                      onClick={() => removeQuestion(q.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <Textarea
                  label="Question text"
                  value={q.text}
                  onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                  required
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input label="Option A" value={q.optA} onChange={(e) => updateQuestion(q.id, { optA: e.target.value })} required />
                  <Input label="Option B" value={q.optB} onChange={(e) => updateQuestion(q.id, { optB: e.target.value })} required />
                  <Input label="Option C (optional)" value={q.optC} onChange={(e) => updateQuestion(q.id, { optC: e.target.value })} />
                  <Input label="Option D (optional)" value={q.optD} onChange={(e) => updateQuestion(q.id, { optD: e.target.value })} />
                </div>
                <Select label="Correct answer" value={q.correct} onChange={(e) => updateQuestion(q.id, { correct: e.target.value })}>
                  {correctOptions.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </Select>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={q.timerEnabled}
                    onChange={(e) => updateQuestion(q.id, { timerEnabled: e.target.checked })}
                  />
                  <span>
                    <span className="font-medium">Time limit for this question</span>
                    <span className="mt-0.5 block text-xs text-muted">Optional — auto-advances when time runs out</span>
                  </span>
                </label>
                {q.timerEnabled && (
                  <Input
                    label="Seconds allowed"
                    type="number"
                    min={1}
                    value={q.timeSec}
                    onChange={(e) => updateQuestion(q.id, { timeSec: e.target.value })}
                  />
                )}
              </div>
            );
          })}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Saving…" : "Save quiz"}
          </Button>
        </form>
      </div>
    </Modal>
  );
}
