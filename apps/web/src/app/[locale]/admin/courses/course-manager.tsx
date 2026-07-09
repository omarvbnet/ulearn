"use client";

import { Badge, Button, Input, Select, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { cn } from "@/lib/utils";
import { compressVideo, formatBytes, isCompressionSupported } from "@/lib/video-compress";
import { useCallback, useEffect, useState } from "react";

/* ── Types ─────────────────────────────────────────── */

type Content = {
  id: string;
  type: "VIDEO" | "PDF" | "ATTACHMENT";
  titleEn?: string | null;
  fileKey: string;
  durationSec?: number | null;
};

type Lesson = {
  id: string;
  nameEn: string;
  isFree: boolean;
  isActive: boolean;
  sortOrder: number;
  contents: Content[];
  quizzes: { id: string; titleEn: string }[];
};

type Chapter = {
  id: string;
  nameEn: string;
  isActive: boolean;
  lessons: Lesson[];
};

type Subject = {
  id: string;
  nameEn: string;
  isActive: boolean;
  isCertificateProgram: boolean;
  chapters: Chapter[];
};

type Stage = {
  id: string;
  nameEn: string;
  nameAr: string;
  nameKu: string;
  nameTr: string;
  sortOrder: number;
  isActive: boolean;
  country: { id: string; nameEn: string; code: string };
  subjects: Subject[];
};

type Country = { id: string; nameEn: string; code: string };

type ModalState =
  | { kind: "stage" }
  | { kind: "editStage"; stage: Stage }
  | { kind: "subject"; stageId: string; countryId: string }
  | { kind: "chapter"; subjectId: string }
  | { kind: "lesson"; chapterId: string }
  | { kind: "content"; lessonId: string }
  | { kind: "quiz"; lessonId: string }
  | null;

/* ── Localized names form fields ───────────────────── */

type Names = { nameEn: string; nameAr: string; nameKu: string; nameTr: string };
const emptyNames: Names = { nameEn: "", nameAr: "", nameKu: "", nameTr: "" };

function NameFields({ value, onChange }: { value: Names; onChange: (v: Names) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Name (English)" value={value.nameEn} onChange={(e) => onChange({ ...value, nameEn: e.target.value })} required />
      <Input label="الاسم (العربية)" dir="rtl" value={value.nameAr} onChange={(e) => onChange({ ...value, nameAr: e.target.value })} required />
      <Input label="ناو (کوردی)" dir="rtl" value={value.nameKu} onChange={(e) => onChange({ ...value, nameKu: e.target.value })} required />
      <Input label="İsim (Türkçe)" value={value.nameTr} onChange={(e) => onChange({ ...value, nameTr: e.target.value })} required />
    </div>
  );
}

/* ── Main manager ──────────────────────────────────── */

export function CourseManager() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<Stage[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [countryFilter, setCountryFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalState>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const query = countryFilter ? `?countryId=${countryFilter}` : "";
    const [treeRes, countriesRes] = await Promise.all([
      fetch(`/api/admin/courses/tree${query}`),
      fetch("/api/countries"),
    ]);
    if (treeRes.ok) {
      const data = await treeRes.json();
      setStages(data.stages);
    }
    if (countriesRes.ok) {
      const data = await countriesRes.json();
      setCountries(data.countries);
    }
    setLoading(false);
  }, [countryFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function remove(entity: string, id: string, label: string) {
    if (!confirm(`Delete "${label}"? It will be soft-deleted and hidden from users.`)) return;
    const routes: Record<string, string> = {
      stage: `/api/admin/stages/${id}`,
      subject: `/api/admin/subjects/${id}`,
      chapter: `/api/admin/chapters/${id}`,
      lesson: `/api/admin/lessons/${id}`,
    };
    const res = await fetch(routes[entity], { method: "DELETE" });
    if (res.ok) {
      toast(`${label} deleted`);
      load();
    } else {
      toast("Delete failed", "error");
    }
  }

  async function toggleFree(lesson: Lesson) {
    const res = await fetch(`/api/admin/lessons/${lesson.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFree: !lesson.isFree }),
    });
    if (res.ok) {
      toast(lesson.isFree ? "Lesson locked" : "Lesson is now free");
      load();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>{c.nameEn}</option>
            ))}
          </Select>
        </div>
        <Button onClick={() => setModal({ kind: "stage" })}>+ New Stage</Button>
      </div>

      {loading ? (
        <SkeletonRows rows={5} />
      ) : stages.length === 0 ? (
        <EmptyState title="No educational stages yet" hint="Create a stage to start building your course tree." />
      ) : (
        <div className="stagger space-y-3">
          {stages.map((stage) => (
            <div key={stage.id} className="card overflow-hidden">
              {/* Stage row */}
              <div
                className="flex cursor-pointer items-center gap-3 p-4 transition hover:bg-white/[0.02]"
                onClick={() => toggle(stage.id)}
              >
                <Chevron open={expanded.has(stage.id)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{stage.nameEn}</p>
                  <p className="text-xs text-muted">
                    {stage.country.nameEn} · {stage.subjects.length} subjects
                  </p>
                </div>
                {!stage.isActive && <Badge status="SUSPENDED">Inactive</Badge>}
                <RowActions
                  onAdd={() => setModal({ kind: "subject", stageId: stage.id, countryId: stage.country.id })}
                  addLabel="+ Subject"
                  onEdit={() => setModal({ kind: "editStage", stage })}
                  onDelete={() => remove("stage", stage.id, stage.nameEn)}
                />
              </div>

              {/* Subjects */}
              {expanded.has(stage.id) && (
                <div className="animate-slide-down border-t border-card-border bg-black/20 p-3 ps-8">
                  {stage.subjects.length === 0 && (
                    <p className="py-2 text-sm text-muted">No subjects yet.</p>
                  )}
                  {stage.subjects.map((subject) => (
                    <div key={subject.id} className="mb-2 rounded-xl border border-card-border/60">
                      <div
                        className="flex cursor-pointer items-center gap-3 p-3 transition hover:bg-white/[0.02]"
                        onClick={() => toggle(subject.id)}
                      >
                        <Chevron open={expanded.has(subject.id)} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{subject.nameEn}</p>
                          <p className="text-xs text-muted">{subject.chapters.length} chapters</p>
                        </div>
                        {subject.isCertificateProgram && <Badge status="FREE">Certificate</Badge>}
                        <RowActions
                          onAdd={() => setModal({ kind: "chapter", subjectId: subject.id })}
                          addLabel="+ Chapter"
                          onDelete={() => remove("subject", subject.id, subject.nameEn)}
                        />
                      </div>

                      {/* Chapters */}
                      {expanded.has(subject.id) && (
                        <div className="animate-slide-down border-t border-card-border/60 p-2 ps-8">
                          {subject.chapters.length === 0 && (
                            <p className="py-2 text-sm text-muted">No chapters yet.</p>
                          )}
                          {subject.chapters.map((chapter) => (
                            <div key={chapter.id} className="mb-1">
                              <div
                                className="flex cursor-pointer items-center gap-3 rounded-lg p-2 transition hover:bg-white/[0.03]"
                                onClick={() => toggle(chapter.id)}
                              >
                                <Chevron open={expanded.has(chapter.id)} />
                                <p className="min-w-0 flex-1 truncate text-sm">{chapter.nameEn}</p>
                                <span className="text-xs text-muted">{chapter.lessons.length} lessons</span>
                                <RowActions
                                  onAdd={() => setModal({ kind: "lesson", chapterId: chapter.id })}
                                  addLabel="+ Lesson"
                                  onDelete={() => remove("chapter", chapter.id, chapter.nameEn)}
                                />
                              </div>

                              {/* Lessons */}
                              {expanded.has(chapter.id) && (
                                <div className="animate-slide-down ms-7 space-y-1 border-s border-card-border/60 ps-3">
                                  {chapter.lessons.map((lesson) => (
                                    <div
                                      key={lesson.id}
                                      className="flex items-center gap-3 rounded-lg p-2 text-sm transition hover:bg-white/[0.03]"
                                    >
                                      <span className="text-muted">▸</span>
                                      <p className="min-w-0 flex-1 truncate">{lesson.nameEn}</p>
                                      <span className="text-xs text-muted">
                                        {lesson.contents.filter((c) => c.type === "VIDEO").length}v ·{" "}
                                        {lesson.contents.filter((c) => c.type !== "VIDEO").length}f ·{" "}
                                        {lesson.quizzes.length}q
                                      </span>
                                      <button
                                        onClick={() => setModal({ kind: "quiz", lessonId: lesson.id })}
                                        className="rounded-lg px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/10"
                                      >
                                        + Quiz
                                      </button>
                                      <button
                                        onClick={() => toggleFree(lesson)}
                                        className={cn(
                                          "badge cursor-pointer transition",
                                          lesson.isFree ? "badge-free" : "badge-pending"
                                        )}
                                        title="Toggle free access"
                                      >
                                        {lesson.isFree ? "Free" : "Locked"}
                                      </button>
                                      <RowActions
                                        onAdd={() => setModal({ kind: "content", lessonId: lesson.id })}
                                        addLabel="+ Media"
                                        onDelete={() => remove("lesson", lesson.id, lesson.nameEn)}
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {modal?.kind === "stage" && (
        <StageModal countries={countries} saving={saving} setSaving={setSaving} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} toast={toast} />
      )}
      {modal?.kind === "editStage" && (
        <EditStageModal stage={modal.stage} saving={saving} setSaving={setSaving} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} toast={toast} />
      )}
      {modal?.kind === "subject" && (
        <SubjectModal stageId={modal.stageId} countryId={modal.countryId} saving={saving} setSaving={setSaving} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} toast={toast} />
      )}
      {modal?.kind === "chapter" && (
        <SimpleNamedModal
          title="New Chapter"
          endpoint="/api/admin/chapters"
          extra={{ subjectId: modal.subjectId }}
          saving={saving} setSaving={setSaving}
          onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} toast={toast}
        />
      )}
      {modal?.kind === "lesson" && (
        <LessonModal chapterId={modal.chapterId} saving={saving} setSaving={setSaving} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} toast={toast} />
      )}
      {modal?.kind === "content" && (
        <ContentModal lessonId={modal.lessonId} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} toast={toast} />
      )}
      {modal?.kind === "quiz" && (
        <QuizBuilderModal lessonId={modal.lessonId} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} toast={toast} />
      )}
    </div>
  );
}

/* ── Small pieces ──────────────────────────────────── */

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      className={cn("shrink-0 text-muted transition-transform duration-200 rtl:-scale-x-100", open && "rotate-90 rtl:rotate-90")}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function RowActions({ onAdd, addLabel, onEdit, onDelete }: { onAdd: () => void; addLabel: string; onEdit?: () => void; onDelete: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button onClick={onAdd} className="rounded-lg px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/10">
        {addLabel}
      </button>
      {onEdit && (
        <button onClick={onEdit} className="rounded-lg px-2 py-1 text-xs font-medium text-muted transition hover:bg-white/5" aria-label="Edit">
          ✎
        </button>
      )}
      <button onClick={onDelete} className="rounded-lg px-2 py-1 text-xs text-danger transition hover:bg-danger/10" aria-label="Delete">
        ✕
      </button>
    </div>
  );
}

type ModalCommon = {
  saving: boolean;
  setSaving: (v: boolean) => void;
  onDone: () => void;
  onClose: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

async function post(endpoint: string, payload: unknown) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

function StageModal({ countries, saving, setSaving, onDone, onClose, toast }: ModalCommon & { countries: Country[] }) {
  const [names, setNames] = useState(emptyNames);
  const [countryId, setCountryId] = useState(countries[0]?.id ?? "");
  const [sortOrder, setSortOrder] = useState("0");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const ok = await post("/api/admin/stages", { ...names, countryId, sortOrder: Number(sortOrder) || 0 });
    setSaving(false);
    if (ok) { toast("Stage created"); onDone(); } else toast("Failed to create stage", "error");
  }

  return (
    <Modal open onClose={onClose} title="New Educational Stage">
      <form onSubmit={submit} className="space-y-4">
        <Select label="Country" value={countryId} onChange={(e) => setCountryId(e.target.value)} required>
          {countries.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
        </Select>
        <NameFields value={names} onChange={setNames} />
        <Input label="Sort order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Create Stage"}</Button>
      </form>
    </Modal>
  );
}

function EditStageModal({ stage, saving, setSaving, onDone, onClose, toast }: ModalCommon & { stage: Stage }) {
  const [names, setNames] = useState({
    nameEn: stage.nameEn,
    nameAr: stage.nameAr,
    nameKu: stage.nameKu,
    nameTr: stage.nameTr,
  });
  const [sortOrder, setSortOrder] = useState(String(stage.sortOrder));
  const [isActive, setIsActive] = useState(stage.isActive);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/admin/stages/${stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...names, sortOrder: Number(sortOrder) || 0, isActive }),
    });
    setSaving(false);
    if (res.ok) { toast("Stage updated"); onDone(); } else toast("Failed to update stage", "error");
  }

  return (
    <Modal open onClose={onClose} title="Edit Educational Stage">
      <form onSubmit={submit} className="space-y-4">
        <NameFields value={names} onChange={setNames} />
        <Input label="Sort order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Save changes"}</Button>
      </form>
    </Modal>
  );
}

function SubjectModal({ stageId, countryId, saving, setSaving, onDone, onClose, toast }: ModalCommon & { stageId: string; countryId: string }) {
  const [names, setNames] = useState(emptyNames);
  const [isCert, setIsCert] = useState(false);
  const [hours, setHours] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const ok = await post("/api/admin/subjects", {
      ...names,
      stageId,
      countryId,
      isCertificateProgram: isCert,
      totalHours: hours ? Number(hours) : 0,
    });
    setSaving(false);
    if (ok) { toast("Subject created"); onDone(); } else toast("Failed to create subject", "error");
  }

  return (
    <Modal open onClose={onClose} title="New Subject">
      <form onSubmit={submit} className="space-y-4">
        <NameFields value={names} onChange={setNames} />
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={isCert} onChange={(e) => setIsCert(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Certificate program (experience certificate track)
        </label>
        {isCert && (
          <Input label="Total hours" type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
        )}
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Create Subject"}</Button>
      </form>
    </Modal>
  );
}

function SimpleNamedModal({ title, endpoint, extra, saving, setSaving, onDone, onClose, toast }: ModalCommon & {
  title: string;
  endpoint: string;
  extra: Record<string, unknown>;
}) {
  const [names, setNames] = useState(emptyNames);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const ok = await post(endpoint, { ...names, ...extra });
    setSaving(false);
    if (ok) { toast("Created"); onDone(); } else toast("Failed", "error");
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <NameFields value={names} onChange={setNames} />
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Create"}</Button>
      </form>
    </Modal>
  );
}

function LessonModal({ chapterId, saving, setSaving, onDone, onClose, toast }: ModalCommon & { chapterId: string }) {
  const [names, setNames] = useState(emptyNames);
  const [description, setDescription] = useState("");
  const [isFree, setIsFree] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const ok = await post("/api/admin/lessons", { ...names, chapterId, description, isFree });
    setSaving(false);
    if (ok) { toast("Lesson created"); onDone(); } else toast("Failed to create lesson", "error");
  }

  return (
    <Modal open onClose={onClose} title="New Lesson">
      <form onSubmit={submit} className="space-y-4">
        <NameFields value={names} onChange={setNames} />
        <Textarea label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Free preview lesson (accessible without subscription)
        </label>
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Create Lesson"}</Button>
      </form>
    </Modal>
  );
}

type DraftQuestion = {
  textEn: string;
  options: { a: string; b: string; c: string; d: string };
  correctKey: "a" | "b" | "c" | "d";
  points: number;
};

const emptyQuestion = (): DraftQuestion => ({
  textEn: "",
  options: { a: "", b: "", c: "", d: "" },
  correctKey: "a",
  points: 1,
});

function QuizBuilderModal({ lessonId, onDone, onClose, toast }: {
  lessonId: string;
  onDone: () => void;
  onClose: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [title, setTitle] = useState("");
  const [timeLimitMin, setTimeLimitMin] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("3");
  const [passPct, setPassPct] = useState("50");
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  const [saving, setSaving] = useState(false);

  function updateQuestion(i: number, patch: Partial<DraftQuestion>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const valid = questions.every(
      (q) => q.textEn.trim() && Object.values(q.options).every((o) => o.trim())
    );
    if (!valid) {
      toast("Fill in every question and all four options", "error");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/admin/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "LESSON",
        lessonId,
        titleEn: title,
        timeLimitSec: timeLimitMin ? Number(timeLimitMin) * 60 : null,
        maxAttempts: Number(maxAttempts),
        passPercentage: Number(passPct),
        questions: questions.map((q) => ({
          textEn: q.textEn,
          options: q.options,
          correctKey: q.correctKey,
          points: q.points,
        })),
      }),
    });
    setSaving(false);
    if (res.ok) { toast("Quiz created"); onDone(); }
    else toast("Failed to create quiz", "error");
  }

  return (
    <Modal open onClose={onClose} title="New Lesson Quiz" wide>
      <form onSubmit={submit} className="space-y-5">
        <Input label="Quiz title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <div className="grid grid-cols-3 gap-3">
          <Input label="Time limit (min, empty = none)" type="number" min="1" value={timeLimitMin} onChange={(e) => setTimeLimitMin(e.target.value)} />
          <Input label="Max attempts" type="number" min="1" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
          <Input label="Pass %" type="number" min="1" max="100" value={passPct} onChange={(e) => setPassPct(e.target.value)} />
        </div>

        <div className="space-y-4">
          {questions.map((q, i) => (
            <div key={i} className="animate-slide-up rounded-xl border border-card-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-accent">Question {i + 1}</p>
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))}
                    className="text-xs text-danger transition hover:opacity-70"
                  >
                    Remove
                  </button>
                )}
              </div>
              <Input
                label="Question text"
                value={q.textEn}
                onChange={(e) => updateQuestion(i, { textEn: e.target.value })}
                required
              />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(["a", "b", "c", "d"] as const).map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateQuestion(i, { correctKey: key })}
                      title="Mark as correct answer"
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition",
                        q.correctKey === key
                          ? "border-success bg-success/20 text-success"
                          : "border-card-border text-muted hover:border-success/50"
                      )}
                    >
                      {key.toUpperCase()}
                    </button>
                    <input
                      className="input !py-2"
                      placeholder={`Option ${key.toUpperCase()}`}
                      value={q.options[key]}
                      onChange={(e) =>
                        updateQuestion(i, { options: { ...q.options, [key]: e.target.value } })
                      }
                      required
                    />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                Tap a letter to mark the correct answer (currently {q.correctKey.toUpperCase()}).
              </p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" onClick={() => setQuestions((qs) => [...qs, emptyQuestion()])}>
            + Add Question
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : `Create Quiz (${questions.length} questions)`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ContentModal({ lessonId, onDone, onClose, toast }: {
  lessonId: string;
  onDone: () => void;
  onClose: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [type, setType] = useState<"VIDEO" | "PDF" | "ATTACHMENT">("VIDEO");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [compress, setCompress] = useState(true);
  const [phase, setPhase] = useState<"compress" | "upload" | null>(null);
  const [progress, setProgress] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    let upload = file;

    // Re-encode large videos in the browser (H.264/AAC MP4, max 1080p)
    // before uploading, so files are smaller and stream better.
    if (type === "VIDEO" && compress) {
      setPhase("compress");
      setProgress(0);
      const result = await compressVideo(file, setProgress);
      upload = result.file;
      if (!result.skipped) {
        toast(
          `Compressed ${formatBytes(result.originalBytes)} → ${formatBytes(result.finalBytes)}`,
          "info"
        );
      }
    }

    const category =
      type === "VIDEO"
        ? "video"
        : upload.type.startsWith("image/")
          ? "image"
          : "document";
    setPhase("upload");
    setProgress(0);

    const presign = await fetch("/api/admin/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: upload.name,
        contentType: upload.type,
        size: upload.size,
        category,
        folder: `lessons/${lessonId}`,
      }),
    });

    if (!presign.ok) {
      const err = await presign.json().catch(() => null);
      setPhase(null);
      toast(err?.error ?? "Upload not allowed", "error");
      return;
    }

    const { uploadUrl, key, publicUrl } = await presign.json();

    // XHR gives us upload progress; fetch does not.
    const uploaded = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", upload.type);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(upload);
    });

    if (!uploaded) {
      setPhase(null);
      toast("Upload to storage failed", "error");
      return;
    }

    const ok = await post(`/api/admin/lessons/${lessonId}/content`, {
      type,
      fileKey: key,
      fileUrl: publicUrl,
      fileSize: upload.size,
      mimeType: upload.type,
      titleEn: title || file.name,
    });

    setPhase(null);
    if (ok) { toast("Content added"); onDone(); } else toast("Failed to save content", "error");
  }

  return (
    <Modal open onClose={onClose} title="Add Lesson Content">
      <form onSubmit={submit} className="space-y-4">
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="VIDEO">Video</option>
          <option value="PDF">PDF</option>
          <option value="ATTACHMENT">Attachment</option>
        </Select>
        <Input label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="block">
          <span className="label">File</span>
          <input
            type="file"
            accept={type === "VIDEO" ? "video/*" : undefined}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input file:me-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-accent"
            required
          />
        </label>
        {type === "VIDEO" && isCompressionSupported() && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={compress}
              onChange={(e) => setCompress(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>
              Compress before upload
              <span className="ms-1 text-xs text-muted">(H.264 · max 1080p · smaller & faster)</span>
            </span>
          </label>
        )}
        {phase !== null && (
          <div>
            <div className="progress-bar"><div style={{ width: `${progress}%` }} /></div>
            <p className="mt-1 text-center text-xs text-muted">
              {phase === "compress" ? `Compressing… ${progress}%` : `Uploading… ${progress}%`}
            </p>
          </div>
        )}
        <Button type="submit" disabled={!file || phase !== null} className="w-full">
          {phase === "compress" ? "Compressing…" : phase === "upload" ? "Uploading…" : "Upload & Attach"}
        </Button>
      </form>
    </Modal>
  );
}
