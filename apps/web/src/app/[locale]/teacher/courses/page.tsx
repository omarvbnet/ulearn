"use client";

import { Badge, Button, Card, Input, PageHeader, Select, StatCard, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { captureVideoThumbnail } from "@/lib/video-thumbnail";
import { useCallback, useEffect, useState } from "react";

type Lesson = {
  id: string;
  title: string;
  durationSec: number | null;
  isFreePreview: boolean;
};

type Course = {
  id: string;
  titleEn: string;
  description: string | null;
  price: number;
  currency: string;
  status: string;
  reviewNotes: string | null;
  closedByLevel: boolean;
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
};

const STATUS_BADGE: Record<string, string> = {
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
  const [lessonsFor, setLessonsFor] = useState<Course | null>(null);
  const [quizzesFor, setQuizzesFor] = useState<Course | null>(null);

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
            <Button onClick={() => setShowCreate(true)}>+ New Course</Button>
          ) : undefined
        }
      />

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
              {c._count.quizzes < 2 && (
                <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-sm text-amber-200">
                  Add at least 2 quizzes before this course can be approved.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
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
        <CreateCourseModal
          meta={meta}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            load();
          }}
          toast={toast}
        />
      )}

      {lessonsFor && (
        <LessonsModal
          course={lessonsFor}
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

function CreateCourseModal({ meta, onClose, onDone, toast }: {
  meta: Meta;
  onClose: () => void;
  onDone: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    titleEn: "",
    titleAr: "",
    description: "",
    subjectId: "",
    stageId: "",
    price: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/teacher/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titleEn: form.titleEn,
        titleAr: form.titleAr || undefined,
        description: form.description || undefined,
        subjectId: form.subjectId,
        stageId: form.stageId,
        price: Number(form.price),
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast("Course submitted for admin review");
      onDone();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(
        d.code === "SUBJECT_NOT_ASSIGNED"
          ? "You can only create courses in your assigned subjects"
          : d.error || "Failed to create course",
        "error"
      );
    }
  }

  return (
    <Modal open onClose={onClose} title="New Course">
      <form onSubmit={submit} className="space-y-4">
        <Input
          label="Title (English)"
          value={form.titleEn}
          onChange={(e) => setForm({ ...form, titleEn: e.target.value })}
          required
        />
        <Input
          label="Title (Arabic)"
          value={form.titleAr}
          onChange={(e) => setForm({ ...form, titleAr: e.target.value })}
          dir="rtl"
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <Select
          label="Subject (your specialization)"
          value={form.subjectId}
          onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
          required
        >
          <option value="">—</option>
          {meta.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nameEn}
            </option>
          ))}
        </Select>
        <Select
          label="Students' stage"
          value={form.stageId}
          onChange={(e) => setForm({ ...form, stageId: e.target.value })}
          required
        >
          <option value="">—</option>
          {meta.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nameEn}
            </option>
          ))}
        </Select>
        <Input
          label="Course price (IQD)"
          type="number"
          min="0"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          required
        />
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Submitting…" : "Submit for Review"}
        </Button>
      </form>
    </Modal>
  );
}

function LessonsModal({ course, onClose, onChanged, toast }: {
  course: Course;
  onClose: () => void;
  onChanged: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [lessons, setLessons] = useState<Lesson[]>(course.lessons);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function addLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setUploading(true);
    setProgress(0);

    try {
      let fileKey: string | undefined;
      let fileUrl: string | undefined;
      let thumbnailKey: string | undefined;
      let thumbnailUrl: string | undefined;
      let durationSec: number | undefined;

      if (file) {
        const presign = await fetch("/api/admin/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            size: file.size,
            category: "video",
            folder: "teacher-courses",
          }),
        });
        if (!presign.ok) throw new Error((await presign.json()).error);
        const { uploadUrl, key, publicUrl } = await presign.json();

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type);
          xhr.upload.onprogress = (ev) =>
            ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
          xhr.onload = () =>
            xhr.status < 300 ? resolve() : reject(new Error("Upload failed"));
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(file);
        });

        fileKey = key;
        fileUrl = publicUrl;

        try {
          const captured = await captureVideoThumbnail(file);
          durationSec = captured.durationSec;
          const thumbName = `${file.name.replace(/\.[^.]+$/, "")}-cover.jpg`;
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
      }

      const res = await fetch(`/api/teacher/courses/${course.id}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          fileKey,
          fileUrl,
          thumbnailKey,
          thumbnailUrl,
          durationSec,
          sortOrder: lessons.length,
          isFreePreview: preview,
        }),
      });
      if (!res.ok) throw new Error("Failed to save lesson");
      const { lesson } = await res.json();
      setLessons([...lessons, lesson]);
      setTitle("");
      setFile(null);
      setPreview(false);
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
    }
  }

  return (
    <Modal open onClose={onClose} title={`Lessons — ${course.titleEn}`} wide>
      <div className="space-y-4">
        {lessons.length > 0 && (
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {lessons.map((l, i) => (
              <li
                key={l.id}
                className="flex items-center justify-between rounded-lg border border-card-border px-3 py-2 text-sm"
              >
                <span>
                  {i + 1}. {l.title}
                  {l.isFreePreview && (
                    <span className="ms-2 text-xs text-accent">free preview</span>
                  )}
                </span>
                <button
                  className="text-danger hover:underline"
                  onClick={() => removeLesson(l.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addLesson} className="space-y-3 border-t border-card-border pt-4">
          <Input
            label="Lesson title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input file:me-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-accent"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={preview}
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
          <Button type="submit" disabled={uploading} className="w-full">
            {uploading ? `Uploading… ${progress}%` : "Add Lesson"}
          </Button>
        </form>
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
                <button
                  className="text-danger hover:underline"
                  onClick={() => removeQuiz(q.id)}
                >
                  Remove
                </button>
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
            <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
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
