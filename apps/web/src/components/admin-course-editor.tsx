"use client";

import { Button, Input, Textarea } from "@/components/ui";
import { Modal, useToast } from "@/components/overlay";
import { captureVideoThumbnail } from "@/lib/video-thumbnail";
import { fetchWatermarkConfig, processVideoForUpload, uploadVideoDirect } from "@/lib/video-process";
import { useCallback, useEffect, useState } from "react";

type Lesson = {
  id: string;
  title: string;
  durationSec: number | null;
  isFreePreview?: boolean;
  isInterview?: boolean;
  freePreviewSec?: number | null;
};

type CourseDocument = {
  id: string;
  title: string;
  type?: string;
  fileUrl?: string | null;
  mimeType?: string | null;
};

type CourseEdit = {
  id: string;
  titleEn: string;
  description: string | null;
  price: number;
  thumbnail?: string | null;
  lessons: Lesson[];
  materials?: CourseDocument[];
};

type AccessMode = "paid" | "fullFree" | "timedFree";

const FREE_MINUTE_PRESETS = [30, 60, 120, 180, 300];

function fmtSec(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AdminCourseEditor({
  courseId,
  courseTitle,
  onClose,
  onChanged,
}: {
  courseId: string;
  courseTitle: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState<CourseEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [form, setForm] = useState({ titleEn: "", description: "", price: "0" });
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonFile, setLessonFile] = useState<File | null>(null);
  const [newAccess, setNewAccess] = useState<AccessMode>("paid");
  const [newFreeSec, setNewFreeSec] = useState(120);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busyLessonId, setBusyLessonId] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUploading, setDocUploading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/teacher/courses/${courseId}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.course) return;
        const c = d.course as CourseEdit;
        setCourse(c);
        setForm({
          titleEn: c.titleEn,
          description: c.description ?? "",
          price: String(c.price),
        });
      })
      .finally(() => setLoading(false));
  }, [courseId]);

  useEffect(load, [load]);

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!course) return;
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

      const res = await fetch(`/api/teacher/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleEn: form.titleEn,
          description: form.description || undefined,
          price: Number(form.price),
          ...(thumbnail ? { thumbnail } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to update course");
      }
      toast("Course updated");
      setCoverFile(null);
      load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update course", "error");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLessonVideo(videoFile: File) {
    const watermark = await fetchWatermarkConfig();
    const processed = await processVideoForUpload(videoFile, {
      watermark,
      courseName: course?.titleEn ?? courseTitle,
      onProgress: setProgress,
      // Admin web uploads often come from iPhone MOV/HEVC — force H.264/MP4
      // so mobile players don't show a black screen.
      forceTranscode: true,
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
      // Optional thumbnail.
    }

    setProgress(0);
    const uploaded = await uploadVideoDirect({
      file: processed.file,
      courseId,
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

  async function addLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!lessonTitle.trim()) return;
    setUploading(true);
    setProgress(0);
    try {
      let fileKey: string | undefined;
      let thumbnailKey: string | undefined;
      let thumbnailUrl: string | undefined;
      let durationSec: number | undefined;
      let videoAssetId: string | undefined;

      if (lessonFile) {
        const uploaded = await uploadLessonVideo(lessonFile);
        fileKey = uploaded.fileKey;
        videoAssetId = uploaded.videoAssetId;
        thumbnailKey = uploaded.thumbnailKey;
        thumbnailUrl = uploaded.thumbnailUrl;
        durationSec = uploaded.durationSec;
      }

      const isFullFree = newAccess === "fullFree";
      const res = await fetch(`/api/teacher/courses/${courseId}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: lessonTitle.trim(),
          fileKey,
          videoAssetId,
          thumbnailKey,
          thumbnailUrl,
          durationSec,
          sortOrder: course?.lessons.length ?? 0,
          isFreePreview: isFullFree,
          freePreviewSec: newAccess === "timedFree" ? newFreeSec : null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to add lesson");
      }
      toast(
        newAccess === "fullFree"
          ? "Free preview video added"
          : newAccess === "timedFree"
            ? `Video added with ${fmtSec(newFreeSec)} free`
            : "Lesson video added"
      );
      setLessonTitle("");
      setLessonFile(null);
      setNewAccess("paid");
      setNewFreeSec(120);
      load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to add lesson", "error");
    } finally {
      setUploading(false);
    }
  }

  async function patchLessonAccess(
    lesson: Lesson,
    payload: { isFreePreview?: boolean; freePreviewSec?: number | null }
  ) {
    setBusyLessonId(lesson.id);
    try {
      const res = await fetch(`/api/teacher/courses/${courseId}/lessons/${lesson.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to update free access");
      }
      toast("Free access updated");
      load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update free access", "error");
    } finally {
      setBusyLessonId(null);
    }
  }

  async function setFullFree(lesson: Lesson, makeFree: boolean) {
    if (lesson.isInterview && !makeFree) {
      toast("Interview video must stay free", "error");
      return;
    }
    await patchLessonAccess(lesson, {
      isFreePreview: makeFree,
      freePreviewSec: makeFree ? null : null,
    });
  }

  async function setTimedFree(lesson: Lesson, sec: number) {
    if (lesson.isFreePreview || lesson.isInterview) {
      toast("Turn off full free preview first to set free minutes", "error");
      return;
    }
    await patchLessonAccess(lesson, {
      isFreePreview: false,
      freePreviewSec: sec > 0 ? sec : null,
    });
  }

  async function clearTimedFree(lesson: Lesson) {
    await patchLessonAccess(lesson, { freePreviewSec: null });
  }

  async function replaceLessonVideo(lesson: Lesson, file: File) {
    setUploading(true);
    setProgress(0);
    try {
      const uploaded = await uploadLessonVideo(file);
      const res = await fetch(`/api/teacher/courses/${courseId}/lessons/${lesson.id}`, {
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
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to replace video");
      }
      toast(`Video updated for "${lesson.title}"`);
      load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to replace video", "error");
    } finally {
      setUploading(false);
    }
  }

  async function removeLesson(lessonId: string) {
    if (!confirm("Remove this lesson video?")) return;
    const res = await fetch(`/api/teacher/courses/${courseId}/lessons`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId }),
    });
    if (res.ok) {
      toast("Lesson removed");
      load();
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Could not remove lesson", "error");
    }
  }

  async function uploadDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!docFile) {
      toast("Pick a PDF", "error");
      return;
    }
    setDocUploading(true);
    try {
      const presign = await fetch("/api/admin/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: docFile.name,
          contentType: "application/pdf",
          size: docFile.size,
          category: "document",
          folder: "teacher-course-pdfs",
        }),
      });
      if (!presign.ok) {
        const d = await presign.json().catch(() => ({}));
        throw new Error(d.error || "Upload failed");
      }
      const { uploadUrl, key, publicUrl } = await presign.json();
      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: docFile,
      });
      const res = await fetch(`/api/teacher/courses/${courseId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: docTitle.trim() || docFile.name.replace(/\.pdf$/i, ""),
          fileKey: key,
          fileUrl: publicUrl,
          mimeType: "application/pdf",
          fileSize: docFile.size,
          type: "PDF",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to add document");
      }
      toast("Document uploaded");
      setDocTitle("");
      setDocFile(null);
      load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to upload document", "error");
    } finally {
      setDocUploading(false);
    }
  }

  async function removeDocument(documentId: string, title: string) {
    if (!confirm(`Remove document "${title}"?`)) return;
    const res = await fetch(`/api/teacher/courses/${courseId}/documents`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId }),
    });
    if (res.ok) {
      toast("Document removed");
      load();
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Could not remove document", "error");
    }
  }

  const documents = course?.materials ?? [];

  const freeCount = course?.lessons.filter((l) => l.isFreePreview).length ?? 0;
  const timedCount =
    course?.lessons.filter((l) => !l.isFreePreview && (l.freePreviewSec ?? 0) > 0).length ?? 0;

  return (
    <Modal open onClose={onClose} title={`Edit course — ${courseTitle}`} wide>
      <div className="max-h-[80vh] space-y-6 overflow-y-auto pe-1">
        {loading && <p className="text-sm text-muted">Loading…</p>}

        {!loading && course && (
          <>
            <form onSubmit={saveDetails} className="space-y-4 rounded-xl border border-card-border p-4">
              <h3 className="text-sm font-semibold">Course details & cover</h3>
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
                label="Price (IQD)"
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
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save course details"}
              </Button>
            </form>

            <div className="space-y-4 rounded-xl border border-card-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Lesson videos & free access</h3>
                  <p className="mt-1 text-xs text-muted">
                    Full free videos: {freeCount} · Timed free minutes: {timedCount}
                  </p>
                </div>
              </div>

              <form onSubmit={addLesson} className="space-y-3 rounded-lg border border-dashed border-card-border p-3">
                <Input
                  label="New lesson title"
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                  required
                />
                <div>
                  <label className="mb-1 block text-sm font-medium">Video file</label>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setLessonFile(e.target.files?.[0] ?? null)}
                    className="input file:me-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-accent"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Student access</p>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["paid", "Paid only"],
                        ["fullFree", "Full free video"],
                        ["timedFree", "Free minutes"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setNewAccess(value)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ${
                          newAccess === value
                            ? "bg-accent/15 text-accent ring-accent/40"
                            : "text-muted ring-card-border hover:bg-card"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {newAccess === "timedFree" && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {FREE_MINUTE_PRESETS.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setNewFreeSec(sec)}
                          className={`rounded-md px-2.5 py-1 text-xs ring-1 ${
                            newFreeSec === sec
                              ? "bg-accent/15 text-accent ring-accent/40"
                              : "text-muted ring-card-border"
                          }`}
                        >
                          {fmtSec(sec)}
                        </button>
                      ))}
                      <Input
                        label="Custom seconds"
                        type="number"
                        min={15}
                        max={3600}
                        value={String(newFreeSec)}
                        onChange={(e) => setNewFreeSec(Number(e.target.value) || 0)}
                        className="max-w-[140px]"
                      />
                    </div>
                  )}
                </div>
                {uploading && (
                  <p className="text-xs text-muted">Uploading… {progress}%</p>
                )}
                <Button type="submit" disabled={uploading}>
                  {uploading ? "Uploading…" : "Add lesson video"}
                </Button>
              </form>

              <ul className="space-y-3">
                {course.lessons.map((lesson, i) => {
                  const timed = !lesson.isFreePreview && (lesson.freePreviewSec ?? 0) > 0;
                  const busy = busyLessonId === lesson.id || uploading;
                  return (
                    <li key={lesson.id} className="rounded-lg border border-card-border p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-sm font-medium">
                            {i + 1}. {lesson.title}
                          </span>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {lesson.isInterview && (
                              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">
                                Interview
                              </span>
                            )}
                            {lesson.isFreePreview && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300">
                                Full free
                              </span>
                            )}
                            {timed && (
                              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-300">
                                Free {fmtSec(lesson.freePreviewSec ?? 0)}
                              </span>
                            )}
                            {!lesson.isFreePreview && !timed && (
                              <span className="rounded bg-card px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-card-border">
                                Paid
                              </span>
                            )}
                            {lesson.durationSec != null && (
                              <span className="text-[11px] text-muted">
                                {Math.round(lesson.durationSec / 60)} min total
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <label className="cursor-pointer text-xs text-accent">
                            Replace
                            <input
                              type="file"
                              accept="video/*"
                              className="hidden"
                              disabled={busy}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void replaceLessonVideo(lesson, f);
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="text-xs text-danger"
                            disabled={busy}
                            onClick={() => removeLesson(lesson.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2 border-t border-card-border pt-3">
                        <p className="text-xs font-medium text-muted">Free access for students</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setFullFree(lesson, true)}
                            className={`rounded-md px-2.5 py-1 text-xs ring-1 ${
                              lesson.isFreePreview
                                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                                : "text-muted ring-card-border hover:bg-card"
                            }`}
                          >
                            Full free video
                          </button>
                          <button
                            type="button"
                            disabled={busy || lesson.isInterview}
                            onClick={() => setFullFree(lesson, false)}
                            className={`rounded-md px-2.5 py-1 text-xs ring-1 ${
                              !lesson.isFreePreview && !timed
                                ? "bg-card text-foreground ring-card-border"
                                : "text-muted ring-card-border hover:bg-card"
                            }`}
                          >
                            Paid only
                          </button>
                        </div>
                        {!lesson.isFreePreview && !lesson.isInterview && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted">Free minutes:</span>
                            {FREE_MINUTE_PRESETS.map((sec) => (
                              <button
                                key={sec}
                                type="button"
                                disabled={busy}
                                onClick={() => setTimedFree(lesson, sec)}
                                className={`rounded-md px-2 py-1 text-xs ring-1 ${
                                  (lesson.freePreviewSec ?? 0) === sec
                                    ? "bg-sky-500/15 text-sky-300 ring-sky-500/30"
                                    : "text-muted ring-card-border hover:bg-card"
                                }`}
                              >
                                {fmtSec(sec)}
                              </button>
                            ))}
                            {timed && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => clearTimedFree(lesson)}
                                className="text-xs text-danger"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
                {course.lessons.length === 0 && (
                  <p className="text-sm text-muted">No lessons yet.</p>
                )}
              </ul>
            </div>

            <div className="space-y-4 rounded-xl border border-card-border p-4">
              <div>
                <h3 className="text-sm font-semibold">Course documents</h3>
                <p className="mt-1 text-xs text-muted">
                  PDFs and supplementary materials for students ({documents.length} uploaded).
                </p>
              </div>

              <form
                onSubmit={uploadDocument}
                className="space-y-3 rounded-lg border border-dashed border-card-border p-3"
              >
                <Input
                  label="Document title"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="e.g. Chapter 1 notes"
                />
                <div>
                  <label className="mb-1 block text-sm font-medium">PDF file</label>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                    className="input file:me-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-accent"
                  />
                </div>
                <Button type="submit" disabled={docUploading || !docFile}>
                  {docUploading ? "Uploading…" : "Upload document"}
                </Button>
              </form>

              <ul className="space-y-2">
                {documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-card-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                      {doc.fileUrl && (
                        <a
                          href={doc.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:underline"
                        >
                          View PDF
                        </a>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-xs text-danger"
                      onClick={() => removeDocument(doc.id, doc.title)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {documents.length === 0 && (
                  <p className="text-sm text-muted">No documents yet.</p>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
