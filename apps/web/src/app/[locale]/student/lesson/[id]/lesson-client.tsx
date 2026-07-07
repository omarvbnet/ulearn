"use client";

import { Badge, Button, Card, Textarea } from "@/components/ui";
import { EmptyState, ProgressBar, Skeleton, useToast } from "@/components/overlay";
import { cn, getLocalizedField } from "@/lib/utils";
import { VideoWatermark } from "@/components/video-watermark";
import { useT } from "@/i18n/client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Content = {
  id: string;
  type: "VIDEO" | "PDF" | "ATTACHMENT";
  titleEn?: string | null;
  fileUrl?: string | null;
  durationSec?: number | null;
};

type Answer = {
  id: string;
  body: string;
  createdAt: string;
  teacher: { fullLegalName: string };
};

type Question = {
  id: string;
  body: string;
  isResolved: boolean;
  createdAt: string;
  student: { id: string; fullLegalName: string };
  answers: Answer[];
};

type LessonData = {
  lesson: {
    id: string;
    nameEn: string;
    description?: string | null;
    contents: Content[];
    quizzes: { id: string; titleEn: string }[];
    questions: Question[];
  };
  progress: { positionSec: number; completionPct: number } | null;
  hasAccess: boolean;
  introOutro?: {
    intro?: { fileUrl?: string | null } | null;
    outro?: { fileUrl?: string | null } | null;
  } | null;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function LessonClient({ lessonId, locale }: { lessonId: string; locale: string }) {
  const t = useT();
  const { toast } = useToast();
  const [data, setData] = useState<LessonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeVideo, setActiveVideo] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [completion, setCompletion] = useState(0);
  const [phase, setPhase] = useState<"intro" | "main" | "outro">("main");

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastReported = useRef(0);
  const resumed = useRef(false);
  const [watermark, setWatermark] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) setWatermark(d.user.phone || d.user.fullLegalName || "");
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/lessons/${lessonId}`);
    if (res.ok) {
      const d: LessonData = await res.json();
      setData(d);
      setCompletion(d.progress?.completionPct ?? 0);
      // Play the branded intro first, unless the student is resuming mid-lesson.
      if (d.introOutro?.intro?.fileUrl && !d.progress?.positionSec) {
        setPhase("intro");
      }
    }
    setLoading(false);
  }, [lessonId]);

  useEffect(() => {
    load();
  }, [load]);

  const videos = data?.lesson.contents.filter((c) => c.type === "VIDEO") ?? [];
  const files = data?.lesson.contents.filter((c) => c.type !== "VIDEO") ?? [];
  const currentVideo = videos[activeVideo];

  const reportProgress = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const now = video.currentTime;
    const delta = Math.max(0, now - lastReported.current);
    lastReported.current = now;

    const res = await fetch("/api/video/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId,
        positionSec: Math.floor(now),
        durationSec: Math.floor(video.duration),
        watchedDeltaSec: Math.floor(Math.min(delta, 30)),
      }),
    });
    if (res.ok) {
      const d = await res.json();
      if (d.progress?.completionPct !== undefined) setCompletion(d.progress.completionPct);
    }
  }, [lessonId]);

  // Heartbeat every 10s while playing, plus on pause/unmount.
  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) reportProgress();
    }, 10_000);
    return () => {
      clearInterval(interval);
      reportProgress();
    };
  }, [reportProgress]);

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    if (!resumed.current && data?.progress?.positionSec) {
      video.currentTime = data.progress.positionSec;
      resumed.current = true;
      toast(`${t.student.resumedFrom} ${formatTime(data.progress.positionSec)}`, "info");
    }
    lastReported.current = video.currentTime;
  }

  function changeSpeed(s: number) {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!data) return <EmptyState title={t.student.noCourses} />;

  if (!data.hasAccess) {
    return (
      <Card className="animate-scale-in mx-auto max-w-md py-12 text-center">
        <div className="animate-float mb-4 text-5xl">🔒</div>
        <h2 className="text-xl font-bold">{t.student.lessonLocked}</h2>
        <p className="mt-2 text-muted">{t.student.lessonLockedHint}</p>
        <Link href={`/${locale}/student/subscriptions`}>
          <Button className="mt-6">{t.student.viewSubscriptions}</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        {/* Player */}
        {currentVideo?.fileUrl ? (
          <div className="animate-scale-in relative overflow-hidden rounded-2xl border border-card-border bg-black shadow-[0_0_48px_rgba(160,32,240,0.15)]">
            <VideoWatermark label={watermark} />
            {phase !== "main" ? (
              <video
                key={phase}
                src={
                  (phase === "intro"
                    ? data.introOutro?.intro?.fileUrl
                    : data.introOutro?.outro?.fileUrl) ?? undefined
                }
                autoPlay
                controls={false}
                onContextMenu={(e) => e.preventDefault()}
                onEnded={() => setPhase("main")}
                onError={() => setPhase("main")}
                className="aspect-video w-full"
              />
            ) : (
              <video
                ref={videoRef}
                key={currentVideo.id}
                src={currentVideo.fileUrl}
                controls
                controlsList="nodownload"
                onContextMenu={(e) => e.preventDefault()}
                onLoadedMetadata={onLoadedMetadata}
                onPause={reportProgress}
                onEnded={() => {
                  reportProgress();
                  if (data.introOutro?.outro?.fileUrl) setPhase("outro");
                }}
                className="aspect-video w-full"
              />
            )}
            {phase === "intro" && (
              <button
                onClick={() => setPhase("main")}
                className="absolute bottom-4 end-4 z-10 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white/90 backdrop-blur hover:bg-black/80"
              >
                {t.common.skip} ›
              </button>
            )}
          </div>
        ) : (
          <Card className="flex aspect-video items-center justify-center">
            <p className="text-muted">{t.student.noVideo}</p>
          </Card>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">{t.student.speed}</span>
          <div className="flex gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => changeSpeed(s)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                  speed === s
                    ? "bg-accent/20 text-accent shadow-[0_0_12px_rgba(0,229,255,0.2)]"
                    : "text-muted hover:bg-white/5"
                )}
              >
                {s}×
              </button>
            ))}
          </div>
          <div className="ms-auto flex min-w-40 items-center gap-2">
            <div className="flex-1"><ProgressBar value={completion} /></div>
            <span className="text-xs font-medium text-accent">{Math.round(completion)}%</span>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold">
            {getLocalizedField(data.lesson as unknown as Record<string, unknown>, "name", locale)}
          </h1>
          {data.lesson.description && (
            <p className="mt-2 text-muted">{data.lesson.description}</p>
          )}
        </div>

        {/* Q&A */}
        <QASection lessonId={lessonId} questions={data.lesson.questions} onPosted={load} />
      </div>

      {/* Sidebar */}
      <div className="space-y-5">
        {videos.length > 1 && (
          <Card className="space-y-2 p-4">
            <h3 className="mb-2 font-semibold">{t.student.videos}</h3>
            {videos.map((v, i) => (
              <button
                key={v.id}
                onClick={() => setActiveVideo(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl p-3 text-start text-sm transition",
                  i === activeVideo ? "bg-accent/10 text-accent" : "hover:bg-white/5"
                )}
              >
                <span className="text-lg">{i === activeVideo ? "▶" : "▹"}</span>
                <span className="min-w-0 flex-1 truncate">{v.titleEn ?? `Part ${i + 1}`}</span>
                {v.durationSec ? (
                  <span className="text-xs text-muted">{formatTime(v.durationSec)}</span>
                ) : null}
              </button>
            ))}
          </Card>
        )}

        {files.length > 0 && (
          <Card className="space-y-2 p-4">
            <h3 className="mb-2 font-semibold">{t.student.materials}</h3>
            {files.map((f) => (
              <a
                key={f.id}
                href={f.fileUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-xl p-3 text-sm transition hover:bg-white/5"
              >
                <span className="badge badge-free">{f.type}</span>
                <span className="min-w-0 flex-1 truncate">{f.titleEn ?? "Attachment"}</span>
              </a>
            ))}
          </Card>
        )}

        {data.lesson.quizzes.length > 0 && (
          <Card className="space-y-3 p-4">
            <h3 className="font-semibold">{t.student.quizzes}</h3>
            {data.lesson.quizzes.map((q) => (
              <Link key={q.id} href={`/${locale}/student/quiz/${q.id}`} className="block">
                <div className="card-hover flex items-center justify-between rounded-xl border border-card-border p-3 text-sm">
                  <span>{q.titleEn}</span>
                  <span className="text-accent">{t.student.start} →</span>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

function QASection({ lessonId, questions, onPosted }: {
  lessonId: string;
  questions: Question[];
  onPosted: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    const res = await fetch(`/api/lessons/${lessonId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: body }),
    });
    setPosting(false);
    if (res.ok) {
      setBody("");
      toast(t.student.questionPosted);
      onPosted();
    } else {
      toast("Failed to post question", "error");
    }
  }

  return (
    <Card className="space-y-5">
      <h2 className="text-lg font-bold">{t.student.qaTitle}</h2>

      <form onSubmit={ask} className="space-y-3">
        <Textarea
          placeholder={t.student.askPlaceholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
        <Button type="submit" disabled={posting || !body.trim()}>
          {posting ? t.student.posting : t.student.askQuestion}
        </Button>
      </form>

      {questions.length === 0 ? (
        <p className="text-sm text-muted">{t.student.noQuestions}</p>
      ) : (
        <div className="stagger space-y-4">
          {questions.map((q) => (
            <div key={q.id} className="rounded-xl border border-card-border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{q.student.fullLegalName}</p>
                <div className="flex items-center gap-2">
                  {q.isResolved && <Badge status="APPROVED">{t.student.answeredBadge}</Badge>}
                  <span className="text-xs text-muted">
                    {new Date(q.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-sm">{q.body}</p>
              {q.answers.map((a) => (
                <div key={a.id} className="mt-3 rounded-lg border-s-2 border-accent/60 bg-accent/5 p-3">
                  <p className="text-xs font-semibold text-accent">
                    {a.teacher.fullLegalName} · {t.student.teacher}
                  </p>
                  <p className="mt-1 text-sm">{a.body}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
