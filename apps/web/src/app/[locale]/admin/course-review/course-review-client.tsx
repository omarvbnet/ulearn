"use client";

import { Badge, Button, Card, PageHeader, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { CourseVideosPanel } from "./course-videos-panel";
import { useCallback, useEffect, useState } from "react";

type Course = {
  id: string;
  titleEn: string;
  description: string | null;
  price: number;
  currency: string;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
  thumbnail?: string | null;
  teacher: {
    id: string;
    level: string;
    isActive: boolean;
    user: { fullLegalName: string | null; phone: string };
  };
  stage: { nameEn: string };
  subject: { nameEn: string };
  lessons: { id: string; title: string; durationSec: number | null }[];
  _count: { purchases: number; quizzes: number };
};

type CourseDetail = Omit<Course, "lessons" | "thumbnail"> & {
  thumbnail: string | null;
  lessons: {
    id: string;
    title: string;
    durationSec: number | null;
    fileUrl: string | null;
    thumbnailUrl: string | null;
    isFreePreview: boolean;
    isInterview: boolean;
  }[];
  materials: {
    id: string;
    title: string;
    type: string;
    fileUrl: string | null;
    mimeType: string | null;
    lessonId?: string | null;
  }[];
  quizzes: {
    id: string;
    titleEn: string;
    titleAr?: string | null;
    afterLessonId?: string | null;
    passPercentage?: number | null;
    timeLimitSec?: number | null;
    maxAttempts?: number | null;
    questions: {
      id: string;
      textEn: string;
      textAr?: string | null;
      options: Record<string, string> | unknown;
      correctKey: string;
      points: number;
      timeLimitSec?: number | null;
      type?: string;
    }[];
    _count: { questions: number };
  }[];
};

type Readiness = {
  hasTitle: boolean;
  hasCover: boolean;
  freeVideos: number;
  hasInterview: boolean;
  timedFreeSec?: number;
  hasTimedFree?: boolean;
  hasSampleAccess?: boolean;
  quizzes: number;
  documents: number;
  ready: boolean;
  missing: string[];
};

type Purchase = {
  id: string;
  price: number;
  currency: string;
  status: string;
  createdAt: string;
  user: { fullLegalName: string | null; phone: string };
  course: {
    titleEn: string;
    teacher: { level: string; user: { fullLegalName: string | null } };
  };
};

type LessonUpdate = {
  id: string;
  title: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  status: string;
  createdAt: string;
  lesson: {
    id: string;
    title: string;
    fileUrl: string | null;
    course: {
      id: string;
      titleEn: string;
      teacher: { user: { fullLegalName: string | null; phone: string } };
    };
  };
};

const LEVEL_BADGE: Record<string, "APPROVED" | "PENDING" | "SUSPENDED"> = {
  MASTER: "APPROVED",
  EXCELLENT: "APPROVED",
  GOOD: "PENDING",
  NEEDS_IMPROVEMENT: "SUSPENDED",
};

function formatDuration(sec: number | null) {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CourseReviewClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState("PENDING_REVIEW");
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [lessonUpdates, setLessonUpdates] = useState<LessonUpdate[] | null>(null);
  const [selected, setSelected] = useState<Course | null>(null);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedUpdate, setSelectedUpdate] = useState<LessonUpdate | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCourses = useCallback(() => {
    setCourses(null);
    setPurchases(null);
    setLessonUpdates(null);
    if (tab === "VIDEO_UPDATES") {
      fetch("/api/admin/lesson-updates?status=PENDING")
        .then((r) => (r.ok ? r.json() : { requests: [] }))
        .then((d) => setLessonUpdates(d.requests || []));
      return;
    }
    const qs = tab === "PURCHASES" ? "" : `?status=${tab}`;
    if (tab !== "PURCHASES") {
      fetch(`/api/admin/teacher-courses${qs}`)
        .then((r) => (r.ok ? r.json() : { courses: [] }))
        .then((d) => setCourses(d.courses || []));
    } else {
      fetch("/api/admin/course-purchases?status=PENDING")
        .then((r) => (r.ok ? r.json() : { purchases: [] }))
        .then((d) => setPurchases(d.purchases || []));
    }
  }, [tab]);

  useEffect(loadCourses, [loadCourses]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setReadiness(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    setReadiness(null);
    fetch(`/api/admin/teacher-courses/${selected.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setDetail(d.course);
        setReadiness(d.readiness);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function review(decision: "APPROVED" | "REJECTED") {
    if (!selected) return;
    setBusy(true);
    const res = await fetch(`/api/admin/teacher-courses/${selected.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, notes: notes || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      toast(
        decision === "APPROVED"
          ? "Course approved and published"
          : "Course rejected — teacher can edit and resubmit"
      );
      setSelected(null);
      setNotes("");
      loadCourses();
    } else {
      const d = await res.json().catch(() => ({}));
      if (d.code === "NOT_READY" || d.code === "INSUFFICIENT_QUIZZES") {
        const missing = d.readiness?.missing?.join(", ") || d.error || "Course is not ready";
        toast(missing, "error");
        if (d.readiness) setReadiness(d.readiness);
      } else {
        toast(
          d.code === "TEACHER_BLOCKED" ? "Teacher account is blocked" : d.error || "Failed",
          "error"
        );
      }
    }
  }

  async function reviewUpdate(decision: "APPROVED" | "REJECTED") {
    if (!selectedUpdate) return;
    setBusy(true);
    const res = await fetch(`/api/admin/lesson-updates/${selectedUpdate.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, notes: notes || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      toast(
        decision === "APPROVED"
          ? "Update approved — subscribers notified"
          : "Update rejected"
      );
      setSelectedUpdate(null);
      setNotes("");
      loadCourses();
    } else {
      toast("Failed", "error");
    }
  }

  async function handlePurchase(purchaseId: string, action: "approve" | "reject") {
    const res = await fetch("/api/admin/course-purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseId, action }),
    });
    if (res.ok) {
      toast(action === "approve" ? "Payment confirmed — course unlocked" : "Purchase rejected");
      loadCourses();
    } else {
      toast("Failed", "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Course Review"
        description="Review teacher courses before they go live, and confirm course payments"
      />

      <Tabs
        tabs={[
          { id: "PENDING_REVIEW", label: "Pending Review" },
          { id: "VIDEO_UPDATES", label: "Video Updates" },
          { id: "COURSE_VIDEOS", label: "Course Videos" },
          { id: "APPROVED", label: "Live" },
          { id: "REJECTED", label: "Rejected" },
          { id: "CLOSED", label: "Closed" },
          { id: "PURCHASES", label: "Purchase Requests" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-6">
        {tab === "COURSE_VIDEOS" ? (
          <CourseVideosPanel />
        ) : tab === "VIDEO_UPDATES" ? (
          lessonUpdates === null ? (
            <SkeletonRows rows={3} />
          ) : lessonUpdates.length === 0 ? (
            <EmptyState title="No pending video updates" />
          ) : (
            <div className="stagger space-y-3">
              {lessonUpdates.map((u) => (
                <Card
                  key={u.id}
                  className="card-hover cursor-pointer"
                  onClick={() => {
                    setSelectedUpdate(u);
                    setNotes("");
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {u.title ?? u.lesson.title}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {u.lesson.course.titleEn} · was &quot;{u.lesson.title}&quot;
                      </p>
                    </div>
                    <Badge status="PENDING">Pending</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {u.lesson.course.teacher.user.fullLegalName} ·{" "}
                    <span dir="ltr">{u.lesson.course.teacher.user.phone}</span> ·{" "}
                    {new Date(u.createdAt).toLocaleString()}
                  </p>
                </Card>
              ))}
            </div>
          )
        ) : tab === "PURCHASES" ? (
          purchases === null ? (
            <SkeletonRows rows={3} />
          ) : purchases.length === 0 ? (
            <EmptyState title="No pending purchases" />
          ) : (
            <div className="stagger space-y-3">
              {purchases.map((p) => (
                <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-semibold">{p.user.fullLegalName}</p>
                    <p className="text-sm text-muted" dir="ltr">{p.user.phone}</p>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">{p.course.titleEn}</p>
                    <p className="text-muted">
                      by {p.course.teacher.user.fullLegalName} ·{" "}
                      <Badge status={LEVEL_BADGE[p.course.teacher.level]}>
                        {p.course.teacher.level.replace(/_/g, " ")}
                      </Badge>
                    </p>
                  </div>
                  <p className="font-semibold text-accent">
                    {p.price} {p.currency}
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={() => handlePurchase(p.id, "approve")}>
                      Confirm Payment
                    </Button>
                    <Button variant="danger" onClick={() => handlePurchase(p.id, "reject")}>
                      Reject
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : courses === null ? (
          <SkeletonRows rows={3} />
        ) : courses.length === 0 ? (
          <EmptyState title="No courses in this tab" />
        ) : (
          <div className="stagger space-y-3">
            {courses.map((c) => (
              <Card
                key={c.id}
                className="card-hover cursor-pointer"
                onClick={() => {
                  setSelected(c);
                  setNotes(c.reviewNotes ?? "");
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{c.titleEn}</p>
                    <p className="mt-1 text-sm text-muted">
                      {c.subject.nameEn} · {c.stage.nameEn} · {c.lessons.length} lessons ·{" "}
                      {c._count.quizzes ?? 0} quizzes · {c._count.purchases} sales
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-accent">
                      {c.price} {c.currency}
                    </span>
                    <Badge status={LEVEL_BADGE[c.teacher.level]}>
                      {c.teacher.level.replace(/_/g, " ")}
                    </Badge>
                    {!c.teacher.isActive && <Badge status="SUSPENDED">Teacher blocked</Badge>}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {c.teacher.user.fullLegalName} · <span dir="ltr">{c.teacher.user.phone}</span> ·{" "}
                  {new Date(c.createdAt).toLocaleString()}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selectedUpdate && (
        <Modal
          open
          onClose={() => setSelectedUpdate(null)}
          title={selectedUpdate.title ?? selectedUpdate.lesson.title}
          wide
        >
          <div className="space-y-4">
            <div className="text-sm text-muted">
              <p>Course: {selectedUpdate.lesson.course.titleEn}</p>
              <p>
                Teacher: {selectedUpdate.lesson.course.teacher.user.fullLegalName}
              </p>
              <p>Current title: {selectedUpdate.lesson.title}</p>
              {selectedUpdate.title && (
                <p>New title: {selectedUpdate.title}</p>
              )}
            </div>
            {(selectedUpdate.fileUrl || selectedUpdate.lesson.fileUrl) && (
              <p className="text-sm">
                {selectedUpdate.fileUrl ? "New video uploaded" : "No media change"}
              </p>
            )}
            <Textarea
              label="Review notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex gap-3">
              <Button disabled={busy} onClick={() => reviewUpdate("APPROVED")}>
                Approve & Notify Subscribers
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => reviewUpdate("REJECTED")}>
                Reject
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {selected && (
        <Modal
          open
          onClose={() => setSelected(null)}
          title={selected.titleEn}
          wide
        >
          <div className="max-h-[75vh] space-y-5 overflow-y-auto pe-1">
            {detailLoading && <p className="text-sm text-muted">Loading course detail…</p>}

            {(detail?.thumbnail || selected.thumbnail) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={(detail?.thumbnail || selected.thumbnail)!}
                alt=""
                className="h-40 w-full rounded-xl object-cover"
              />
            )}

            {(detail?.description || selected.description) && (
              <p className="text-sm">{detail?.description || selected.description}</p>
            )}

            <div className="grid gap-2 text-sm text-muted sm:grid-cols-2">
              <p>
                Teacher: {selected.teacher.user.fullLegalName} (
                {selected.teacher.level.replace(/_/g, " ")})
              </p>
              <p dir="ltr">{selected.teacher.user.phone}</p>
              <p>
                {(detail?.subject || selected.subject).nameEn} ·{" "}
                {(detail?.stage || selected.stage).nameEn}
              </p>
              <p className="font-semibold text-accent">
                {selected.price} {selected.currency}
              </p>
            </div>

            {readiness && (
              <div className="rounded-xl border border-card-border p-3">
                <p className="mb-2 text-sm font-semibold">
                  Readiness {readiness.ready ? "✓ Ready" : "— Incomplete"}
                </p>
                <ul className="grid gap-1 text-xs sm:grid-cols-2">
                  <li className={readiness.hasTitle ? "text-accent" : "text-danger"}>
                    Title {readiness.hasTitle ? "✓" : "✗"}
                  </li>
                  <li className={readiness.hasCover ? "text-accent" : "text-danger"}>
                    Cover {readiness.hasCover ? "✓" : "✗"}
                  </li>
                  <li className={readiness.hasSampleAccess ? "text-accent" : "text-danger"}>
                    Sample access {readiness.hasSampleAccess ? "✓" : "✗"}
                    <span className="ms-1 text-xs text-muted">
                      (free videos {readiness.freeVideos}/2
                      {readiness.hasTimedFree
                        ? ` · free minutes ${Math.floor((readiness.timedFreeSec ?? 0) / 60)}m`
                        : " · or 2 free minutes"}
                      )
                    </span>
                  </li>
                  <li className={readiness.quizzes >= 2 ? "text-accent" : "text-danger"}>
                    Quizzes {readiness.quizzes}/2
                  </li>
                  <li className={readiness.documents >= 1 ? "text-accent" : "text-danger"}>
                    Documents {readiness.documents}/1
                  </li>
                </ul>
                {!readiness.ready && readiness.missing.length > 0 && (
                  <p className="mt-2 text-xs text-danger">{readiness.missing.join(" · ")}</p>
                )}
              </div>
            )}

            {detail && (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    Lessons ({detail.lessons.length})
                  </h3>
                  {detail.lessons.length === 0 ? (
                    <p className="text-sm text-muted">No lessons</p>
                  ) : (
                    <ul className="space-y-3">
                      {detail.lessons.map((l, i) => (
                        <li
                          key={l.id}
                          className="rounded-xl border border-card-border p-3"
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">
                              {i + 1}. {l.title}
                            </span>
                            {l.isInterview && (
                              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">
                                Interview
                              </span>
                            )}
                            {l.isFreePreview && !l.isInterview && (
                              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-300">
                                Free preview
                              </span>
                            )}
                            {formatDuration(l.durationSec) && (
                              <span className="text-xs text-muted">
                                {formatDuration(l.durationSec)}
                              </span>
                            )}
                          </div>
                          {l.fileUrl ? (
                            <video
                              src={l.fileUrl}
                              controls
                              preload="metadata"
                              className="max-h-48 w-full rounded-lg bg-black"
                            />
                          ) : (
                            <p className="text-xs text-muted">No video URL</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    Quizzes ({detail.quizzes.length})
                  </h3>
                  {detail.quizzes.length === 0 ? (
                    <p className="text-sm text-muted">No quizzes</p>
                  ) : (
                    <ul className="space-y-3">
                      {detail.quizzes.map((q) => {
                        const afterLesson = detail.lessons.find((l) => l.id === q.afterLessonId);
                        const questions = q.questions ?? [];
                        return (
                          <li
                            key={q.id}
                            className="rounded-xl border border-border bg-card/40 p-3"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="font-medium">{q.titleEn}</span>
                              <span className="text-xs text-muted">
                                {questions.length || q._count.questions} questions
                                {q.passPercentage != null ? ` · pass ${q.passPercentage}%` : ""}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted">
                              {afterLesson
                                ? `After video: ${afterLesson.title}`
                                : "At end of course"}
                            </p>
                            {questions.length > 0 && (
                              <ol className="mt-3 space-y-3">
                                {questions.map((question, qi) => {
                                  const options =
                                    question.options &&
                                    typeof question.options === "object" &&
                                    !Array.isArray(question.options)
                                      ? (question.options as Record<string, string>)
                                      : {};
                                  return (
                                    <li key={question.id} className="text-sm">
                                      <p className="font-medium text-foreground">
                                        {qi + 1}. {question.textEn}
                                      </p>
                                      <ul className="mt-1.5 space-y-1 pl-1">
                                        {Object.entries(options).map(([key, label]) => {
                                          const correct = key === question.correctKey;
                                          return (
                                            <li
                                              key={key}
                                              className={
                                                correct
                                                  ? "rounded-md bg-accent/10 px-2 py-1 text-accent"
                                                  : "px-2 py-0.5 text-muted"
                                              }
                                            >
                                              <span className="font-semibold">{key}.</span> {label}
                                              {correct ? " ✓" : ""}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </li>
                                  );
                                })}
                              </ol>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    Documents ({detail.materials.length})
                  </h3>
                  {detail.materials.length === 0 ? (
                    <p className="text-sm text-muted">No documents</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {detail.materials.map((m) => {
                        const afterLesson = detail.lessons.find((l) => l.id === m.lessonId);
                        return (
                          <li key={m.id}>
                            {m.fileUrl ? (
                              <a
                                href={m.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent hover:underline"
                              >
                                {m.title}
                              </a>
                            ) : (
                              m.title
                            )}{" "}
                            <span className="text-xs text-muted">
                              ({m.type}
                              {afterLesson
                                ? ` · after: ${afterLesson.title}`
                                : " · course-level"}
                              )
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}

            <Textarea
              label="Review notes (sent to the teacher on rejection)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy || (readiness ? !readiness.ready : false)}
                onClick={() => review("APPROVED")}
              >
                Approve & Publish
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => review("REJECTED")}>
                Reject for edits
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
