"use client";

import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";

const WhiteboardPlayer = dynamic(
  () => import("@/components/whiteboard/whiteboard-player"),
  { ssr: false, loading: () => <p className="text-sm text-muted">Loading player…</p> }
);

type LessonPayload = {
  id: string;
  title: string;
  lessonType?: string;
  packageUrl?: string | null;
  whiteboardId?: string | null;
  watchPositionSec?: number;
  freePreviewSec?: number | null;
  previewOnly?: boolean;
  canWatch?: boolean;
};

/** Student store whiteboard lesson player (lazy-loaded; video lessons stay on existing paths). */
export default function StoreWhiteboardLessonPage() {
  const params = useParams<{ locale: string; courseId: string; lessonId: string }>();
  const search = useSearchParams();
  const [lesson, setLesson] = useState<LessonPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/store/courses/${params.courseId}`);
        if (!res.ok) throw new Error("Course not found");
        const data = await res.json();
        const found = (data.course?.lessons ?? []).find(
          (l: LessonPayload) => l.id === params.lessonId
        );
        if (!found) throw new Error("Lesson not found");
        if (found.lessonType !== "WHITEBOARD") throw new Error("Not a whiteboard lesson");
        if (!found.canWatch) throw new Error("No access");
        if (!cancelled) setLesson(found);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.courseId, params.lessonId]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <PageHeader title="Whiteboard lesson" />
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <PageHeader title="Whiteboard lesson" />
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader title={lesson.title || "Whiteboard lesson"} />
      <WhiteboardPlayer
        title={lesson.title}
        packageUrl={lesson.packageUrl}
        whiteboardId={lesson.whiteboardId}
        initialPositionSec={
          Number(search.get("t")) || lesson.watchPositionSec || 0
        }
        freePreviewSec={lesson.previewOnly ? lesson.freePreviewSec : null}
        onProgress={(positionSec, durationSec, isCompleted) => {
          void fetch(`/api/store/lessons/${lesson.id}/progress`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              positionSec,
              durationSec,
              completionPct: durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0,
              isCompleted,
            }),
          });
        }}
      />
    </div>
  );
}
