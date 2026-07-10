"use client";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/overlay";
import { cn } from "@/lib/utils";
import { captureVideoThumbnail } from "@/lib/video-thumbnail";
import { fetchWatermarkConfig, processVideoForUpload, uploadVideoDirect } from "@/lib/video-process";
import { useCallback, useEffect, useState } from "react";

type Meta = {
  subjects: { id: string; nameEn: string }[];
  stages: { id: string; nameEn: string }[];
};

type Readiness = {
  hasTitle: boolean;
  hasCover: boolean;
  freeVideos: number;
  hasInterview: boolean;
  quizzes: number;
  documents: number;
  ready: boolean;
  missing: string[];
};

type Lesson = {
  id: string;
  title: string;
  isFreePreview?: boolean;
  isInterview?: boolean;
  durationSec?: number | null;
};

type Quiz = { id: string; titleEn: string; _count?: { questions: number } };
type Doc = { id: string; title: string };

const STEPS = ["Basics", "Free videos", "Quizzes", "Document", "Submit"];

export function CourseWizard({
  meta,
  courseId: initialCourseId,
  onClose,
  onDone,
}: {
  meta: Meta;
  courseId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [courseId, setCourseId] = useState<string | undefined>(initialCourseId);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);

  const [titleEn, setTitleEn] = useState("");
  const [description, setDescription] = useState("");
  const [subjectId, setSubjectId] = useState(meta.subjects[0]?.id ?? "");
  const [stageId, setStageId] = useState(meta.stages[0]?.id ?? "");
  const [price, setPrice] = useState("0");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  const [videoTitle, setVideoTitle] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [asInterview, setAsInterview] = useState(true);

  const [quizTitle, setQuizTitle] = useState("");
  const [qText, setQText] = useState("");
  const [optA, setOptA] = useState("");
  const [optB, setOptB] = useState("");
  const [correct, setCorrect] = useState("A");

  const [docFile, setDocFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState("");

  const freeCount = lessons.filter((l) => l.isFreePreview).length;
  const hasInterview = lessons.some((l) => l.isInterview);

  const refresh = useCallback(async (id: string) => {
    const [courseRes, readyRes, docsRes] = await Promise.all([
      fetch(`/api/teacher/courses/${id}`),
      fetch(`/api/teacher/courses/${id}/readiness`),
      fetch(`/api/teacher/courses/${id}/documents`),
    ]);
    if (courseRes.ok) {
      const { course } = await courseRes.json();
      setTitleEn(course.titleEn ?? "");
      setDescription(course.description ?? "");
      setSubjectId(course.subjectId ?? course.subject?.id ?? subjectId);
      setStageId(course.stageId ?? course.stage?.id ?? stageId);
      setPrice(String(course.price ?? 0));
      setCoverUrl(course.thumbnail ?? null);
      setLessons(course.lessons ?? []);
      setQuizzes(course.quizzes ?? []);
    }
    if (readyRes.ok) {
      const { readiness: r } = await readyRes.json();
      setReadiness(r);
    }
    if (docsRes.ok) {
      const { documents } = await docsRes.json();
      setDocs(documents ?? []);
    }
  }, [subjectId, stageId]);

  useEffect(() => {
    if (initialCourseId) {
      refresh(initialCourseId).then(() => {
        // jump to first incomplete step after load
      });
    }
  }, [initialCourseId, refresh]);

  async function uploadCover(file: File) {
    const presign = await fetch("/api/admin/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "image/jpeg",
        size: file.size,
        category: "image",
        folder: "teacher-covers",
      }),
    });
    if (!presign.ok) throw new Error((await presign.json()).error);
    const { uploadUrl, publicUrl } = await presign.json();
    await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    return publicUrl as string;
  }

  async function saveBasics() {
    if (!titleEn.trim() || !subjectId || !stageId) {
      toast("Fill title, subject, and stage", "error");
      return;
    }
    if (!coverFile && !coverUrl) {
      toast("Add a course cover", "error");
      return;
    }
    setBusy(true);
    try {
      let thumbnail = coverUrl;
      if (coverFile) thumbnail = await uploadCover(coverFile);
      const payload = {
        titleEn: titleEn.trim(),
        description: description.trim() || undefined,
        subjectId,
        stageId,
        price: Number(price) || 0,
        thumbnail,
      };
      if (!courseId) {
        const res = await fetch("/api/teacher/courses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        const { course } = await res.json();
        setCourseId(course.id);
        await refresh(course.id);
      } else {
        const res = await fetch(`/api/teacher/courses/${courseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        await refresh(courseId);
      }
      setStep(1);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFreeVideo() {
    if (!courseId || !videoFile || !videoTitle.trim()) {
      toast("Pick a video and title", "error");
      return;
    }
    if (asInterview === false && !hasInterview) {
      toast("Upload the interview video first", "error");
      return;
    }
    if (freeCount >= 2) {
      toast("Maximum 2 free videos", "error");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const watermark = await fetchWatermarkConfig();
      const processed = await processVideoForUpload(videoFile, {
        watermark,
        courseName: titleEn,
        onProgress: setProgress,
      });
      let durationSec: number | undefined;
      try {
        durationSec = (await captureVideoThumbnail(processed.file)).durationSec;
      } catch {
        /* optional */
      }
      const uploaded = await uploadVideoDirect({
        file: processed.file,
        courseId,
        scope: "STORE_COURSE",
        durationSec,
        onProgress: setProgress,
      });
      const res = await fetch(`/api/teacher/courses/${courseId}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: videoTitle.trim(),
          fileKey: uploaded.objectKey,
          videoAssetId: uploaded.videoId,
          durationSec,
          isFreePreview: true,
          isInterview: asInterview || !hasInterview,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setVideoFile(null);
      setVideoTitle("");
      setAsInterview(false);
      await refresh(courseId);
      toast("Video uploaded");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  async function saveQuiz() {
    if (!courseId || !quizTitle.trim() || !qText.trim() || !optA.trim() || !optB.trim()) {
      toast("Fill quiz title and one question with options A/B", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/teacher/courses/${courseId}/quizzes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleEn: quizTitle.trim(),
          questions: [
            {
              textEn: qText.trim(),
              options: { A: optA.trim(), B: optB.trim() },
              correctKey: correct,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setQuizTitle("");
      setQText("");
      setOptA("");
      setOptB("");
      await refresh(courseId);
      toast("Quiz saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadDoc() {
    if (!courseId || !docFile) {
      toast("Pick a PDF", "error");
      return;
    }
    setBusy(true);
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
      if (!presign.ok) throw new Error((await presign.json()).error);
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
      if (!res.ok) throw new Error((await res.json()).error);
      setDocFile(null);
      setDocTitle("");
      await refresh(courseId);
      toast("Document uploaded");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!courseId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/teacher/courses/${courseId}/submit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast(data.readiness?.missing?.join(", ") || data.error || "Not ready", "error");
        if (data.readiness) setReadiness(data.readiness);
        return;
      }
      toast("Submitted for review");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (step === 0) return saveBasics();
    if (step === 1 && !(hasInterview && freeCount >= 2)) {
      toast("Add interview + one more free video", "error");
      return;
    }
    if (step === 2 && quizzes.length < 2) {
      toast("Add at least 2 quizzes", "error");
      return;
    }
    if (step === 3 && docs.length < 1 && (readiness?.documents ?? 0) < 1) {
      toast("Upload at least one document", "error");
      return;
    }
    if (step === 4) return submit();
    if (courseId) await refresh(courseId);
    setStep((s) => Math.min(4, s + 1));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-card-border bg-[var(--bg)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-card-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Create course</h2>
            <p className="text-sm text-muted">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
          </div>
          <button className="text-muted hover:text-foreground" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex gap-2 border-b border-card-border px-5 py-3">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i <= step ? "bg-accent" : "bg-white/10"
              )}
            />
          ))}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {step === 0 && (
            <>
              <Input label="Course title" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
              <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  {meta.subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.nameEn}</option>
                  ))}
                </Select>
                <Select label="Stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  {meta.stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.nameEn}</option>
                  ))}
                </Select>
              </div>
              <Input label="Price (IQD)" type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
              <div>
                <p className="mb-2 text-sm text-muted">Course cover</p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
                />
                {(coverFile || coverUrl) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={coverFile ? URL.createObjectURL(coverFile) : coverUrl!}
                    alt="Cover"
                    className="mt-3 h-36 w-full rounded-xl object-cover"
                  />
                )}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm text-muted">
                Upload an interview / intro video first, then one free sample ({freeCount}/2).
              </p>
              <ul className="space-y-2">
                {lessons.filter((l) => l.isFreePreview).map((l) => (
                  <li key={l.id} className="rounded-lg border border-card-border px-3 py-2 text-sm">
                    {l.isInterview ? "🎤 " : "▶ "}{l.title}
                  </li>
                ))}
              </ul>
              {freeCount < 2 && (
                <div className="space-y-3 rounded-xl border border-card-border p-4">
                  <Input
                    label={hasInterview ? "Free sample title" : "Interview video title"}
                    value={videoTitle}
                    onChange={(e) => setVideoTitle(e.target.value)}
                    placeholder={hasInterview ? "Free sample" : "Interview / Intro"}
                  />
                  {!hasInterview && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={asInterview} onChange={(e) => setAsInterview(e.target.checked)} />
                      Mark as interview / intro
                    </label>
                  )}
                  <input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} />
                  {busy && progress > 0 && (
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                  <Button disabled={busy} onClick={uploadFreeVideo}>
                    {busy ? `Uploading ${progress}%…` : "Upload free video"}
                  </Button>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-muted">Add at least 2 quizzes ({quizzes.length}/2).</p>
              <ul className="space-y-2">
                {quizzes.map((q) => (
                  <li key={q.id} className="rounded-lg border border-card-border px-3 py-2 text-sm">
                    {q.titleEn} · {q._count?.questions ?? "?"} questions
                  </li>
                ))}
              </ul>
              {quizzes.length < 2 && (
                <div className="space-y-3 rounded-xl border border-card-border p-4">
                  <Input label="Quiz title" value={quizTitle} onChange={(e) => setQuizTitle(e.target.value)} />
                  <Input label="Question" value={qText} onChange={(e) => setQText(e.target.value)} />
                  <Input label="Option A" value={optA} onChange={(e) => setOptA(e.target.value)} />
                  <Input label="Option B" value={optB} onChange={(e) => setOptB(e.target.value)} />
                  <Select label="Correct" value={correct} onChange={(e) => setCorrect(e.target.value)}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                  </Select>
                  <Button disabled={busy} onClick={saveQuiz}>Save quiz</Button>
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-muted">Upload at least one PDF ({Math.max(docs.length, readiness?.documents ?? 0)}/1).</p>
              <ul className="space-y-2">
                {docs.map((d) => (
                  <li key={d.id} className="rounded-lg border border-card-border px-3 py-2 text-sm">📄 {d.title}</li>
                ))}
              </ul>
              <div className="space-y-3 rounded-xl border border-card-border p-4">
                <Input label="Document title" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                <input type="file" accept="application/pdf" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
                <Button disabled={busy} onClick={uploadDoc}>Upload PDF</Button>
              </div>
            </>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm text-muted">Confirm checklist, then submit for admin review.</p>
              {[
                ["Title", readiness?.hasTitle],
                ["Cover", readiness?.hasCover],
                ["Interview", readiness?.hasInterview],
                [`Free videos (${readiness?.freeVideos ?? 0}/2)`, (readiness?.freeVideos ?? 0) >= 2],
                [`Quizzes (${readiness?.quizzes ?? 0}/2)`, (readiness?.quizzes ?? 0) >= 2],
                [`Documents (${readiness?.documents ?? 0}/1)`, (readiness?.documents ?? 0) >= 1],
              ].map(([label, ok]) => (
                <div key={String(label)} className="flex items-center gap-2 text-sm">
                  <span className={ok ? "text-emerald-400" : "text-muted"}>{ok ? "✓" : "○"}</span>
                  {label as string}
                </div>
              ))}
              {!!readiness?.missing?.length && (
                <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
                  Missing: {readiness.missing.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-card-border px-5 py-4">
          <Button variant="ghost" disabled={busy || step === 0} onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
          <Button disabled={busy} onClick={next}>
            {step === 4 ? (busy ? "Submitting…" : "Submit for review") : busy ? "Working…" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}
