"use client";

import { useEffect, useRef, useState } from "react";
import { ULearnLogo } from "@/components/ulearn-logo";
import { cn } from "@/lib/utils";

/**
 * Animated U Learn vector-logo intro (~5s) before whiteboard playback.
 * Tap / click to skip.
 */
export function WhiteboardBrandIntro({
  lessonTitle,
  onFinished,
  durationMs = 5000,
  className,
}: {
  lessonTitle?: string;
  onFinished?: () => void;
  durationMs?: number;
  className?: string;
}) {
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(0);
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    finishedRef.current = false;

    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinishedRef.current?.();
    };

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      setProgress(t);
      if (elapsed >= durationMs - 720) setExiting(true);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  const skip = () => {
    if (finishedRef.current) return;
    setExiting(true);
    window.setTimeout(() => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinishedRef.current?.();
    }, 420);
  };

  return (
    <button
      type="button"
      aria-label="Skip intro"
      onClick={skip}
      className={cn(
        "absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center overflow-hidden border-0 bg-[#050510] text-center transition-opacity duration-700",
        exiting ? "opacity-0" : "opacity-100",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(180,76,240,0.32),transparent_55%),radial-gradient(ellipse_at_70%_70%,rgba(61,139,255,0.18),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,255,255,0.4)_1px,transparent_1px)] [background-size:20px_20px]" />

      <div className="ulearn-intro-pop relative z-10 flex flex-col items-center gap-5 px-6">
        <ULearnLogo size={132} animated glow />
        <div className="ulearn-intro-rise space-y-2">
          <div className="bg-gradient-to-r from-[#B44CF0] via-[#3D8BFF] to-[#00E5FF] bg-clip-text text-3xl font-extrabold tracking-wide text-transparent">
            U Learn
          </div>
          <div className="max-w-xs text-xs font-medium tracking-[0.18em] text-white/70">
            {lessonTitle?.trim() || "Whiteboard lesson"}
          </div>
        </div>
      </div>

      <div className="absolute bottom-7 left-0 right-0 z-10 flex flex-col items-center gap-2">
        <div className="h-[3px] w-32 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#B44CF0] via-[#3D8BFF] to-[#00E5FF]"
            style={{ width: `${Math.max(5, progress * 100)}%` }}
          />
        </div>
        <span className="text-[11px] tracking-widest text-white/45">Tap to skip</span>
      </div>
    </button>
  );
}
