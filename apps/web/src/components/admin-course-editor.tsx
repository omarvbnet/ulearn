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
};

type CourseEdit = {
  id: string;
  titleEn: string;
  description: string | null;
  price: number;
  thumbnail?: string | null;
  lessons: Lesson[];
};

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
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

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
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to add lesson");
      }
      toast("Lesson video added");
      setLessonTitle("");
      setLessonFile(null);
      load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to add lesson", "error");
    } finally {
      setUploading(false);
    }
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
              <h3 className="text-sm font-semibold">Lesson videos</h3>
              <form onSubmit={addLesson} className="space-y-3">
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
                {uploading && (
                  <p className="text-xs text-muted">Uploading… {progress}%</p>
                )}
                <Button type="submit" disabled={uploading}>
                  {uploading ? "Uploading…" : "Add lesson video"}
                </Button>
              </form>

              <ul className="space-y-3">
                {course.lessons.map((lesson, i) => (
                  <li key={lesson.id} className="rounded-lg border border-card-border p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {i + 1}. {lesson.title}
                      </span>
                      <div className="flex gap-2">
                        <label className="cursor-pointer text-xs text-accent">
                          Replace video
                          <input
                            type="file"
                            accept="video/*"
                            className="hidden"
                            disabled={uploading}
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
                          disabled={uploading}
                          onClick={() => removeLesson(lesson.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {lesson.durationSec != null && (
                      <p className="text-xs text-muted">
                        {Math.round(lesson.durationSec / 60)} min
                      </p>
                    )}
                  </li>
                ))}
                {course.lessons.length === 0 && (
                  <p className="text-sm text-muted">No lessons yet.</p>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
