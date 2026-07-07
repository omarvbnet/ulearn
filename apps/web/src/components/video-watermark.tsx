"use client";

import { useEffect, useState } from "react";

/**
 * Dynamic anti-piracy watermark laid over the video.
 * Shows the viewer's identity and moves every few seconds so it can't be
 * cropped out of a screen recording.
 */
export function VideoWatermark({ label }: { label: string }) {
  const [pos, setPos] = useState({ top: 8, left: 8 });

  useEffect(() => {
    const move = () =>
      setPos({ top: 8 + Math.random() * 74, left: 8 + Math.random() * 64 });
    move();
    const interval = setInterval(move, 7000);
    return () => clearInterval(interval);
  }, []);

  if (!label) return null;

  return (
    <div
      className="pointer-events-none absolute z-10 select-none rounded bg-black/25 px-2 py-0.5 font-mono text-[11px] text-white/50 transition-all duration-1000"
      style={{ top: `${pos.top}%`, left: `${pos.left}%` }}
      dir="ltr"
    >
      {label}
    </div>
  );
}
