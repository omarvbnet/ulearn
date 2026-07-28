"use client";

import { Badge, Button, Card, Input, PageHeader, Textarea } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { AdminCourseEditor } from "@/components/admin-course-editor";
import { CourseVideosPanel } from "./course-videos-panel";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

const WhiteboardPlayer = dynamic(
  () => import("@/components/whiteboard/whiteboard-player"),
  { ssr: false }
);

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

type ChangeSummary = {
  firstReview?: boolean;
  note?: string;
  titleChanged?: boolean;
  previousTitle?: string;
  titleEn?: string;
  priceChanged?: boolean;
  previousPrice?: number;
  price?: number;
  stageChanged?: boolean;
  subjectChanged?: boolean;
  thumbnailChanged?: boolean;
  addedLessons?: { id: string; title?: string }[];
  removedLessons?: { id: string; title?: string }[];
  changedLessons?: {
    id: string;
    previousTitle?: string;
    title?: string;
    videoChanged?: boolean;
    whiteboardChanged?: boolean;
    lessonType?: string | null;
  }[];
  addedQuizzes?: { id: string; titleEn?: string }[];
  removedQuizzes?: { id: string; titleEn?: string }[];
  addedMaterials?: { id: string; title?: string }[];
  removedMaterials?: { id: string; title?: string }[];
};

type CourseDetail = Omit<Course, "lessons" | "thumbnail"> & {
  thumbnail: string | null;
  accessMonths?: number;
  appleProductId?: string | null;
  googleProductId?: string | null;
  pendingChangeSummary?: ChangeSummary | null;
  lessons: {
    id: string;
    title: string;
    durationSec: number | null;
    fileUrl: string | null;
    thumbnailUrl: string | null;
    isFreePreview: boolean;
    isInterview: boolean;
    lessonType?: "VIDEO" | "WHITEBOARD" | string | null;
    whiteboardAssetId?: string | null;
    whiteboardId?: string | null;
    packageUrl?: string | null;
    whiteboardTheme?: string | null;
    whiteboardStatus?: string | null;
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
  kind?: "course" | "group";
  user: { fullLegalName: string | null; phone: string };
  course?: {
    titleEn: string;
    teacher: { level: string; user: { fullLegalName: string | null } };
  };
  group?: {
    titleEn: string;
    stage?: { nameEn?: string | null } | null;
    items?: { courseId: string }[];
  };
};

type LessonUpdate = {
  id: string;
  title: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  durationSec?: number | null;
  status: string;
  createdAt: string;
  currentTitle?: string | null;
  currentFileUrl?: string | null;
  currentThumbnailUrl?: string | null;
  currentDurationSec?: number | null;
  newTitle?: string | null;
  newFileUrl?: string | null;
  newThumbnailUrl?: string | null;
  newDurationSec?: number | null;
  changeTags?: string[];
  isWhiteboard?: boolean;
  editDiff?: {
    ranges: { id: string; startMs: number; endMs: number; kind: string; removedMs?: number }[];
    previousDurationMs?: number;
    newDurationMs?: number;
  } | null;
  previousWhiteboardPackageUrl?: string | null;
  newWhiteboardPackageUrl?: string | null;
  previousWhiteboardDurationSec?: number | null;
  newWhiteboardDurationSec?: number | null;
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
  const [accessMonths, setAccessMonths] = useState("10");
  const [appleProductId, setAppleProductId] = useState("");
  const [googleProductId, setGoogleProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [contentEditorFor, setContentEditorFor] = useState<Course | null>(null);
  /** When false, Pending Review shows only newest additions/updates (not the whole course). */
  const [showFullCourse, setShowFullCourse] = useState(false);

  const [purchaseFilter, setPurchaseFilter] = useState<"PENDING" | "PAID">("PENDING");

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
    // Course Videos panel loads its own lesson list — do not treat the tab id as CourseStatus.
    if (tab === "COURSE_VIDEOS" || tab === "PURCHASES") {
      if (tab === "COURSE_VIDEOS") return;
    } else {
      // Only real CourseStatus values may be sent to the API.
      const courseStatuses = new Set([
        "DRAFT",
        "PENDING_REVIEW",
        "APPROVED",
        "REJECTED",
        "CLOSED",
      ]);
      if (!courseStatuses.has(tab)) return;
      fetch(`/api/admin/teacher-courses?status=${encodeURIComponent(tab)}`)
        .then((r) => (r.ok ? r.json() : { courses: [] }))
        .then((d) => setCourses(d.courses || []));
      return;
    }
    Promise.all([
      fetch(`/api/admin/course-purchases?status=${purchaseFilter}`).then((r) =>
        r.ok ? r.json() : { purchases: [] }
      ),
      fetch(`/api/admin/course-group-purchases?status=${purchaseFilter}`).then(
        (r) => (r.ok ? r.json() : { purchases: [] })
      ),
    ]).then(([courseData, groupData]) => {
      const coursePurchases: Purchase[] = (courseData.purchases || []).map(
        (p: Purchase) => ({ ...p, kind: "course" as const })
      );
      const groupPurchases: Purchase[] = (groupData.purchases || []).map(
        (p: {
          id: string;
          price: number;
          currency: string;
          status: string;
          createdAt: string;
          user: Purchase["user"];
          group: Purchase["group"];
        }) => ({
          id: p.id,
          price: p.price,
          currency: p.currency,
          status: p.status,
          createdAt: p.createdAt,
          user: p.user,
          group: p.group,
          kind: "group" as const,
        })
      );
      setPurchases(
        [...groupPurchases, ...coursePurchases].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      );
    });
  }, [tab, purchaseFilter]);

  useEffect(loadCourses, [loadCourses]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setReadiness(null);
      setShowFullCourse(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setShowFullCourse(false);
    setDetail(null);
    setReadiness(null);
    fetch(`/api/admin/teacher-courses/${selected.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setDetail(d.course);
        setReadiness(d.readiness);
        setAccessMonths(String(d.course?.accessMonths ?? 10));
        setAppleProductId(d.course?.appleProductId ?? "");
        setGoogleProductId(d.course?.googleProductId ?? "");
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
      body: JSON.stringify({
        decision,
        notes: notes || undefined,
        accessMonths: Number(accessMonths) || 10,
        appleProductId: appleProductId.trim() || null,
        googleProductId: googleProductId.trim() || null,
      }),
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
      setAccessMonths("10");
      setAppleProductId("");
      setGoogleProductId("");
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

  async function handlePurchase(
    purchaseId: string,
    action: "approve" | "reject" | "cancel",
    kind: "course" | "group" = "course"
  ) {
    if (
      action === "cancel" &&
      !confirm("Cancel this paid access? The student will lose course access immediately.")
    ) {
      return;
    }
    const endpoint =
      kind === "group"
        ? "/api/admin/course-group-purchases"
        : "/api/admin/course-purchases";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseId, action }),
    });
    if (res.ok) {
      toast(
        action === "approve"
          ? kind === "group"
            ? "Group payment confirmed — all courses unlocked"
            : "Payment confirmed — course unlocked"
          : action === "cancel"
            ? "Access cancelled"
            : "Purchase rejected"
      );
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
          { id: "VIDEO_UPDATES", label: "Media Updates" },
          { id: "COURSE_VIDEOS", label: "Course Videos" },
          { id: "APPROVED", label: "Live" },
          { id: "REJECTED", label: "Rejected" },
          { id: "CLOSED", label: "Closed" },
          { id: "PURCHASES", label: "Purchases" },
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
            <EmptyState title="No pending media updates" />
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
                        {u.newTitle ?? u.title ?? u.lesson.title}
                        {u.isWhiteboard && (
                          <span className="ms-2 text-xs font-medium text-accent">whiteboard</span>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {u.lesson.course.titleEn} · was &quot;{u.currentTitle ?? u.lesson.title}&quot;
                      </p>
                      {u.isWhiteboard && (u.editDiff?.ranges?.length ?? 0) > 0 && (
                        <p className="mt-1 text-xs text-accent">
                          {u.editDiff!.ranges.length} edited segment
                          {u.editDiff!.ranges.length === 1 ? "" : "s"} for review
                        </p>
                      )}
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
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <Button
                variant={purchaseFilter === "PENDING" ? "primary" : "outline"}
                className="!py-1.5 text-xs"
                onClick={() => setPurchaseFilter("PENDING")}
              >
                Pending requests
              </Button>
              <Button
                variant={purchaseFilter === "PAID" ? "primary" : "outline"}
                className="!py-1.5 text-xs"
                onClick={() => setPurchaseFilter("PAID")}
              >
                Active (paid)
              </Button>
            </div>
            {purchases === null ? (
              <SkeletonRows rows={3} />
            ) : purchases.length === 0 ? (
              <EmptyState
                title={
                  purchaseFilter === "PAID"
                    ? "No active course subscriptions"
                    : "No pending purchases"
                }
              />
            ) : (
              <div className="stagger space-y-3">
                {purchases.map((p) => (
                  <Card
                    key={`${p.kind}-${p.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div>
                      <p className="font-semibold">{p.user.fullLegalName}</p>
                      <p className="text-sm text-muted" dir="ltr">
                        {p.user.phone}
                      </p>
                    </div>
                    <div className="text-sm">
                      {p.kind === "group" ? (
                        <>
                          <p className="font-medium">
                            Group: {p.group?.titleEn ?? "Course group"}
                          </p>
                          <p className="text-muted">
                            {p.group?.stage?.nameEn ?? "—"} ·{" "}
                            {p.group?.items?.length ?? 0} courses
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium">{p.course?.titleEn}</p>
                          <p className="text-muted">
                            by {p.course?.teacher.user.fullLegalName} ·{" "}
                            <Badge
                              status={
                                LEVEL_BADGE[p.course?.teacher.level ?? ""] ??
                                "PENDING"
                              }
                            >
                              {(p.course?.teacher.level ?? "").replace(/_/g, " ")}
                            </Badge>
                          </p>
                        </>
                      )}
                    </div>
                    <p className="font-semibold text-accent">
                      {p.price} {p.currency}
                    </p>
                    <div className="flex gap-2">
                      {purchaseFilter === "PENDING" ? (
                        <>
                          <Button
                            onClick={() =>
                              handlePurchase(p.id, "approve", p.kind ?? "course")
                            }
                          >
                            Confirm Payment
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() =>
                              handlePurchase(p.id, "reject", p.kind ?? "course")
                            }
                          >
                            Reject
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="danger"
                          onClick={() =>
                            handlePurchase(p.id, "cancel", p.kind ?? "course")
                          }
                        >
                          Cancel access
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : courses === null ? (
          <SkeletonRows rows={3} />
        ) : courses.length === 0 ? (
          <EmptyState title="No courses in this tab" />
        ) : (
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {courses.map((c) => (
              <Card
                key={c.id}
                className="card-hover cursor-pointer overflow-hidden p-0"
                onClick={() => {
                  setSelected(c);
                  setNotes(c.reviewNotes ?? "");
                }}
              >
                <div className="relative aspect-[16/9] bg-card-border/40">
                  {c.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.thumbnail}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted">
                      No cover
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent p-3">
                    <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs font-semibold text-white">
                      {c.price} {c.currency}
                    </span>
                    <Badge status={LEVEL_BADGE[c.teacher.level]}>
                      {c.teacher.level.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 font-semibold leading-snug">{c.titleEn}</p>
                    <Badge status={c.status === "APPROVED" ? "APPROVED" : c.status === "REJECTED" ? "REJECTED" : "PENDING"}>
                      {c.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted">
                    {c.description?.trim() || "No description"}
                  </p>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded-full border border-card-border px-2 py-0.5 text-muted">
                      {c.subject.nameEn}
                    </span>
                    <span className="rounded-full border border-card-border px-2 py-0.5 text-muted">
                      {c.stage.nameEn}
                    </span>
                    <span className="rounded-full border border-card-border px-2 py-0.5 text-muted">
                      {c.lessons.length} lessons
                    </span>
                    <span className="rounded-full border border-card-border px-2 py-0.5 text-muted">
                      {c._count.quizzes ?? 0} quizzes
                    </span>
                    <span className="rounded-full border border-card-border px-2 py-0.5 text-muted">
                      {c._count.purchases} sales
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {c.teacher.user.fullLegalName} ·{" "}
                    <span dir="ltr">{c.teacher.user.phone}</span>
                    {!c.teacher.isActive && (
                      <>
                        {" · "}
                        <Badge status="SUSPENDED">Teacher blocked</Badge>
                      </>
                    )}
                  </p>
                  <p className="text-[11px] text-muted">
                    {new Date(c.createdAt).toLocaleString()} · Tap to open full content
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selectedUpdate && (
        <Modal
          open
          onClose={() => setSelectedUpdate(null)}
          title={selectedUpdate.newTitle ?? selectedUpdate.title ?? selectedUpdate.lesson.title}
          wide
        >
          <div className="space-y-4">
            <div className="text-sm text-muted">
              <p>Course: {selectedUpdate.lesson.course.titleEn}</p>
              <p>
                Teacher: {selectedUpdate.lesson.course.teacher.user.fullLegalName}
              </p>
            </div>

            {(selectedUpdate.changeTags?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedUpdate.changeTags!.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-card-border p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  Current
                </p>
                <p className="font-medium">
                  {selectedUpdate.currentTitle ?? selectedUpdate.lesson.title}
                </p>
                {selectedUpdate.currentDurationSec != null && (
                  <p className="text-xs text-muted">
                    Duration: {formatDuration(selectedUpdate.currentDurationSec)}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
                  Proposed
                </p>
                <p className="font-medium">
                  {selectedUpdate.newTitle ??
                    selectedUpdate.title ??
                    selectedUpdate.lesson.title}
                </p>
                {(selectedUpdate.newDurationSec ?? selectedUpdate.durationSec) !=
                  null && (
                  <p className="text-xs text-muted">
                    Duration:{" "}
                    {formatDuration(
                      selectedUpdate.newDurationSec ??
                        selectedUpdate.durationSec ??
                        null
                    )}
                  </p>
                )}
              </div>
            </div>

            {selectedUpdate.isWhiteboard ? (
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  Review only the edited time ranges (before vs after). Full lesson is not required.
                </p>
                {(selectedUpdate.editDiff?.ranges?.length ?? 0) === 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-semibold text-muted">Before</p>
                      {selectedUpdate.previousWhiteboardPackageUrl ? (
                        <WhiteboardPlayer
                          packageUrl={selectedUpdate.previousWhiteboardPackageUrl}
                          compact
                          title="Before"
                        />
                      ) : (
                        <div className="flex aspect-video items-center justify-center rounded-xl border border-card-border text-sm text-muted">
                          No previous package
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold text-accent">After</p>
                      {selectedUpdate.newWhiteboardPackageUrl ? (
                        <WhiteboardPlayer
                          packageUrl={selectedUpdate.newWhiteboardPackageUrl}
                          compact
                          title="After"
                        />
                      ) : (
                        <div className="flex aspect-video items-center justify-center rounded-xl border border-card-border text-sm text-muted">
                          No new package
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  selectedUpdate.editDiff!.ranges.map((range) => {
                    const end =
                      range.endMs > range.startMs
                        ? range.endMs
                        : range.startMs + Math.max(3000, range.removedMs ?? 3000);
                    const fmt = (ms: number) => {
                      const s = Math.floor(ms / 1000);
                      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
                    };
                    return (
                      <div
                        key={range.id}
                        className="space-y-2 rounded-xl border border-card-border p-3"
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                          {range.kind} · {fmt(range.startMs)}–{fmt(end)}
                          {range.removedMs ? ` · removed ${fmt(range.removedMs)}` : ""}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs text-muted">Before</p>
                            {selectedUpdate.previousWhiteboardPackageUrl ? (
                              <WhiteboardPlayer
                                key={`before-${range.id}-${selectedUpdate.id}`}
                                packageUrl={selectedUpdate.previousWhiteboardPackageUrl}
                                startMs={range.startMs}
                                endMs={end}
                                compact
                              />
                            ) : (
                              <div className="flex h-40 items-center justify-center rounded-xl border border-card-border text-xs text-muted">
                                Missing before package
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="mb-1 text-xs text-accent">After</p>
                            {selectedUpdate.newWhiteboardPackageUrl ? (
                              <WhiteboardPlayer
                                key={`after-${range.id}-${selectedUpdate.id}`}
                                packageUrl={selectedUpdate.newWhiteboardPackageUrl}
                                startMs={range.startMs}
                                endMs={end}
                                compact
                              />
                            ) : (
                              <div className="flex h-40 items-center justify-center rounded-xl border border-card-border text-xs text-muted">
                                Missing after package
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-muted">Current video</p>
                {(selectedUpdate.currentFileUrl || selectedUpdate.lesson.fileUrl) ? (
                  <video
                    key={selectedUpdate.currentFileUrl || selectedUpdate.lesson.fileUrl || "cur"}
                    controls
                    playsInline
                    className="aspect-video w-full rounded-xl bg-black"
                    src={
                      (selectedUpdate.currentFileUrl ||
                        selectedUpdate.lesson.fileUrl)!
                    }
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-xl border border-card-border text-sm text-muted">
                    No current video
                  </div>
                )}
                {(selectedUpdate.currentThumbnailUrl ||
                  selectedUpdate.lesson.fileUrl) &&
                  selectedUpdate.currentThumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedUpdate.currentThumbnailUrl}
                      alt=""
                      className="mt-2 h-16 w-28 rounded-lg object-cover"
                    />
                  )}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-accent">New video</p>
                {(selectedUpdate.newFileUrl || selectedUpdate.fileUrl) ? (
                  <video
                    key={selectedUpdate.newFileUrl || selectedUpdate.fileUrl || "new"}
                    controls
                    playsInline
                    className="aspect-video w-full rounded-xl bg-black ring-1 ring-accent/40"
                    src={(selectedUpdate.newFileUrl || selectedUpdate.fileUrl)!}
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-xl border border-card-border text-sm text-muted">
                    No new video uploaded
                  </div>
                )}
                {(selectedUpdate.newThumbnailUrl ||
                  selectedUpdate.thumbnailUrl) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      (selectedUpdate.newThumbnailUrl ||
                        selectedUpdate.thumbnailUrl)!
                    }
                    alt=""
                    className="mt-2 h-16 w-28 rounded-lg object-cover ring-1 ring-accent/30"
                  />
                )}
              </div>
            </div>
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

            {detail?.pendingChangeSummary && (
              <div className="rounded-xl border border-accent/35 bg-accent/5 p-3">
                <p className="mb-2 text-sm font-semibold text-accent">
                  What changed
                </p>
                {detail.pendingChangeSummary.firstReview ? (
                  <p className="text-sm text-muted">
                    {detail.pendingChangeSummary.note ||
                      "First review — no prior approved snapshot."}
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {detail.pendingChangeSummary.titleChanged && (
                      <li>
                        Title:{" "}
                        <span className="text-muted">
                          {detail.pendingChangeSummary.previousTitle}
                        </span>{" "}
                        → {detail.pendingChangeSummary.titleEn}
                      </li>
                    )}
                    {detail.pendingChangeSummary.priceChanged && (
                      <li>
                        Price: {detail.pendingChangeSummary.previousPrice} →{" "}
                        {detail.pendingChangeSummary.price}
                      </li>
                    )}
                    {detail.pendingChangeSummary.stageChanged && (
                      <li>Stage changed</li>
                    )}
                    {detail.pendingChangeSummary.subjectChanged && (
                      <li>Subject changed</li>
                    )}
                    {detail.pendingChangeSummary.thumbnailChanged && (
                      <li>Cover / thumbnail updated</li>
                    )}
                    {(detail.pendingChangeSummary.addedLessons?.length ?? 0) >
                      0 && (
                      <li>
                        Added lessons:{" "}
                        {detail.pendingChangeSummary.addedLessons!.map((l) => l.title || l.id).join(", ")}
                      </li>
                    )}
                    {(detail.pendingChangeSummary.removedLessons?.length ?? 0) >
                      0 && (
                      <li>
                        Removed lessons:{" "}
                        {detail.pendingChangeSummary.removedLessons!.map((l) => l.title || l.id).join(", ")}
                      </li>
                    )}
                    {(detail.pendingChangeSummary.changedLessons?.length ?? 0) >
                      0 && (
                      <li>
                        Updated lessons:{" "}
                        {detail.pendingChangeSummary.changedLessons!
                          .map((l) => {
                            const tags = [
                              l.whiteboardChanged ? "board" : null,
                              l.videoChanged ? "video" : null,
                            ].filter(Boolean);
                            return `${l.title || l.id}${tags.length ? ` (${tags.join(", ")})` : ""}`;
                          })
                          .join(", ")}
                      </li>
                    )}
                    {(detail.pendingChangeSummary.addedQuizzes?.length ?? 0) >
                      0 && (
                      <li>
                        Added quizzes:{" "}
                        {detail.pendingChangeSummary.addedQuizzes!.map((q) => q.titleEn || q.id).join(", ")}
                      </li>
                    )}
                    {(detail.pendingChangeSummary.removedQuizzes?.length ?? 0) >
                      0 && (
                      <li>
                        Removed quizzes:{" "}
                        {detail.pendingChangeSummary.removedQuizzes!.map((q) => q.titleEn || q.id).join(", ")}
                      </li>
                    )}
                    {(detail.pendingChangeSummary.addedMaterials?.length ?? 0) >
                      0 && (
                      <li>
                        Added documents:{" "}
                        {detail.pendingChangeSummary.addedMaterials!.map((m) => m.title || m.id).join(", ")}
                      </li>
                    )}
                    {(detail.pendingChangeSummary.removedMaterials?.length ?? 0) >
                      0 && (
                      <li>
                        Removed documents:{" "}
                        {detail.pendingChangeSummary.removedMaterials!.map((m) => m.title || m.id).join(", ")}
                      </li>
                    )}
                  </ul>
                )}
              </div>
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
                {(() => {
                  const summary = detail.pendingChangeSummary;
                  const deltaMode =
                    Boolean(summary) &&
                    !summary?.firstReview &&
                    !showFullCourse;
                  const focusLessonIds = new Set([
                    ...(summary?.addedLessons?.map((l) => l.id) ?? []),
                    ...(summary?.changedLessons?.map((l) => l.id) ?? []),
                  ]);
                  const focusQuizIds = new Set(
                    summary?.addedQuizzes?.map((q) => q.id) ?? []
                  );
                  const focusMaterialIds = new Set(
                    summary?.addedMaterials?.map((m) => m.id) ?? []
                  );
                  const hasContentFocus =
                    focusLessonIds.size > 0 ||
                    focusQuizIds.size > 0 ||
                    focusMaterialIds.size > 0;
                  const reviewLessons =
                    deltaMode && hasContentFocus
                      ? detail.lessons.filter((l) => focusLessonIds.has(l.id))
                      : deltaMode && !hasContentFocus
                        ? []
                        : detail.lessons;
                  const reviewQuizzes =
                    deltaMode && hasContentFocus
                      ? detail.quizzes.filter((q) => focusQuizIds.has(q.id))
                      : deltaMode && !hasContentFocus
                        ? []
                        : detail.quizzes;
                  const reviewMaterials =
                    deltaMode && hasContentFocus
                      ? detail.materials.filter((m) => focusMaterialIds.has(m.id))
                      : deltaMode && !hasContentFocus
                        ? []
                        : detail.materials;
                  const addedLessonIds = new Set(
                    summary?.addedLessons?.map((l) => l.id) ?? []
                  );
                  const changedLessonIds = new Set(
                    summary?.changedLessons?.map((l) => l.id) ?? []
                  );

                  return (
                    <>
                      {summary && !summary.firstReview && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-card-border bg-card/40 px-3 py-2">
                          <p className="text-sm text-muted">
                            {showFullCourse
                              ? "Showing full course content"
                              : hasContentFocus
                                ? "Showing only newest additions & updates"
                                : "Metadata-only changes — no new lesson content to audit"}
                          </p>
                          <Button
                            variant="outline"
                            onClick={() => setShowFullCourse((v) => !v)}
                          >
                            {showFullCourse
                              ? "Show changes only"
                              : "Show full course"}
                          </Button>
                        </div>
                      )}

                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    {deltaMode && hasContentFocus
                      ? `Lessons to review (${reviewLessons.length})`
                      : `Lessons (${reviewLessons.length})`}
                  </h3>
                  {reviewLessons.length === 0 ? (
                    <p className="text-sm text-muted">
                      {deltaMode && !hasContentFocus
                        ? "No lesson media changed in this update."
                        : "No lessons"}
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {reviewLessons.map((l, i) => {
                        const isBoard =
                          l.lessonType === "WHITEBOARD" || Boolean(l.whiteboardId || l.whiteboardAssetId);
                        const packageUrl = l.packageUrl || (isBoard ? l.fileUrl : null);
                        return (
                        <li
                          key={l.id}
                          className="rounded-xl border border-card-border p-3"
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">
                              {i + 1}. {l.title}
                            </span>
                            {addedLessonIds.has(l.id) && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300">
                                New
                              </span>
                            )}
                            {changedLessonIds.has(l.id) && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-200">
                                Updated
                              </span>
                            )}
                            {isBoard && (
                              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-xs text-violet-200">
                                Board (.ubrd)
                              </span>
                            )}
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
                          {isBoard ? (
                            <div className="space-y-2">
                              {packageUrl || l.whiteboardId ? (
                                <WhiteboardPlayer
                                  packageUrl={packageUrl}
                                  whiteboardId={l.whiteboardId || l.whiteboardAssetId}
                                  title={l.title}
                                  compact
                                  autoPlay={false}
                                />
                              ) : (
                                <p className="text-xs text-muted">No UBRD package URL</p>
                              )}
                              {packageUrl && (
                                <a
                                  href={packageUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex text-xs text-accent hover:underline"
                                  download={`${l.title || "lesson"}.ubrd`}
                                >
                                  Download .ubrd for audit
                                </a>
                              )}
                            </div>
                          ) : l.fileUrl ? (
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
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    {deltaMode && hasContentFocus
                      ? `Quizzes to review (${reviewQuizzes.length})`
                      : `Quizzes (${reviewQuizzes.length})`}
                  </h3>
                  {reviewQuizzes.length === 0 ? (
                    <p className="text-sm text-muted">
                      {deltaMode ? "No new quizzes in this update." : "No quizzes"}
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {reviewQuizzes.map((q) => {
                        const afterLesson = detail.lessons.find((l) => l.id === q.afterLessonId);
                        const questions = q.questions ?? [];
                        return (
                          <li
                            key={q.id}
                            className="rounded-xl border border-border bg-card/40 p-3"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="font-medium">{q.titleEn}</span>
                              {(deltaMode || focusQuizIds.has(q.id)) && (
                                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300">
                                  New
                                </span>
                              )}
                              <span className="text-xs text-muted">
                                {questions.length || q._count.questions} questions
                                {q.passPercentage != null ? ` · pass ${q.passPercentage}%` : ""}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted">
                              {afterLesson
                                ? `After lesson: ${afterLesson.title}`
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
                    {deltaMode && hasContentFocus
                      ? `Documents to review (${reviewMaterials.length})`
                      : `Documents (${reviewMaterials.length})`}
                  </h3>
                  {reviewMaterials.length === 0 ? (
                    <p className="text-sm text-muted">
                      {deltaMode ? "No new documents in this update." : "No documents"}
                    </p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {reviewMaterials.map((m) => {
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
                            {focusMaterialIds.has(m.id) && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300">
                                New
                              </span>
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
                  );
                })()}
              </>
            )}

            <div className="space-y-3 rounded-xl border border-card-border p-3">
              <h3 className="text-sm font-semibold">Subscription / IAP</h3>
              <p className="text-xs text-muted">
                Access length after purchase (months). Set App Store / Play product IDs
                so Subscribe uses in-app purchase on iPhone and Android.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label="Access months"
                  type="number"
                  min={1}
                  max={120}
                  value={accessMonths}
                  onChange={(e) => setAccessMonths(e.target.value)}
                />
                <Input
                  label="Apple product ID"
                  placeholder={`com.ulearn.mobile.course.${selected.id}`}
                  value={appleProductId}
                  onChange={(e) => setAppleProductId(e.target.value)}
                />
                <Input
                  label="Google product ID"
                  placeholder={`course_${selected.id}`}
                  value={googleProductId}
                  onChange={(e) => setGoogleProductId(e.target.value)}
                />
              </div>
            </div>

            <Textarea
              label="Review notes (sent to the teacher on rejection)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => setContentEditorFor(selected)}
              >
                Edit videos & cover
              </Button>
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

      {contentEditorFor && (
        <AdminCourseEditor
          courseId={contentEditorFor.id}
          courseTitle={contentEditorFor.titleEn}
          onClose={() => setContentEditorFor(null)}
          onChanged={() => {
            loadCourses();
            if (selected?.id === contentEditorFor.id) {
              setDetail(null);
              setDetailLoading(true);
              fetch(`/api/admin/teacher-courses/${contentEditorFor.id}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => {
                  if (d) {
                    setDetail(d.course);
                    setReadiness(d.readiness);
                  }
                })
                .finally(() => setDetailLoading(false));
            }
          }}
        />
      )}
    </div>
  );
}
