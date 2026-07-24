"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardState } from "@/lib/whiteboard/board-state";
import { EventEngine } from "@/lib/whiteboard/event-engine";
import { parseUbrdPackage } from "@/lib/whiteboard/package";
import {
  LOGICAL_BOARD_HEIGHT,
  LOGICAL_BOARD_WIDTH,
  type ParsedUbrdPackage,
} from "@/lib/whiteboard/types";

type Props = {
  packageUrl?: string | null;
  whiteboardId?: string | null;
  title?: string;
  initialPositionSec?: number;
  freePreviewSec?: number | null;
  /** Clip playback for admin review of edited ranges. */
  startMs?: number;
  endMs?: number;
  autoPlay?: boolean;
  compact?: boolean;
  onProgress?: (positionSec: number, durationSec: number, completed: boolean) => void;
};

export default function WhiteboardPlayer({
  packageUrl,
  whiteboardId,
  title,
  initialPositionSec = 0,
  freePreviewSec,
  startMs,
  endMs,
  autoPlay = false,
  compact = false,
  onProgress,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const boardRef = useRef(new BoardState());
  const engineRef = useRef(new EventEngine());
  const eventIndexRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pkg, setPkg] = useState<ParsedUbrdPackage | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [, bump] = useState(0);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const parsed = pkg;
    if (!canvas || !parsed) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bw = parsed.manifest.boardWidth || LOGICAL_BOARD_WIDTH;
    const bh = parsed.manifest.boardHeight || LOGICAL_BOARD_HEIGHT;
    const scale = Math.min(rect.width / bw, rect.height / bh);
    const dx = (rect.width - bw * scale) / 2;
    const dy = (rect.height - bh * scale) / 2;
    const board = boardRef.current;
    const bg = board.theme === "BLACK" ? "#0B0F14" : "#F8FAFC";

    ctx.fillStyle = board.theme === "BLACK" ? "#111827" : "#EEF2F7";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.scale(scale, scale);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, bw, bh);

    const page = board.currentPage;
    if (page) {
      for (const shape of page.shapes) {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.width;
        ctx.beginPath();
        if (shape.kind === "circle") {
          ctx.ellipse(
            (shape.x1 + shape.x2) / 2,
            (shape.y1 + shape.y2) / 2,
            Math.abs(shape.x2 - shape.x1) / 2,
            Math.abs(shape.y2 - shape.y1) / 2,
            0,
            0,
            Math.PI * 2
          );
        } else if (shape.kind === "line" || shape.kind === "arrow") {
          ctx.moveTo(shape.x1, shape.y1);
          ctx.lineTo(shape.x2, shape.y2);
        } else {
          ctx.rect(shape.x1, shape.y1, shape.x2 - shape.x1, shape.y2 - shape.y1);
        }
        ctx.stroke();
      }
      for (const stroke of page.strokes) {
        if (!stroke.points.length) continue;
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.globalAlpha = stroke.opacity;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i]!.x, stroke.points[i]!.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const text of page.texts) {
        ctx.fillStyle = text.color;
        ctx.font = `${text.fontSize}px system-ui, sans-serif`;
        ctx.fillText(text.text, text.x, text.y);
      }
      if (board.laser?.visible && board.laser.pageId === page.id) {
        ctx.beginPath();
        ctx.fillStyle = "rgba(239,68,68,0.85)";
        ctx.arc(board.laser.x, board.laser.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }, [pkg]);

  const applyUntil = useCallback((ms: number) => {
    boardRef.current.reset();
    if (pkg) boardRef.current.theme = pkg.manifest.theme;
    eventIndexRef.current = 0;
    const events = engineRef.current.all;
    while (eventIndexRef.current < events.length && events[eventIndexRef.current]!.t <= ms) {
      boardRef.current.apply(events[eventIndexRef.current]!);
      eventIndexRef.current++;
    }
    bump((n) => n + 1);
  }, [pkg]);

  const applyForward = useCallback((ms: number) => {
    const events = engineRef.current.all;
    while (eventIndexRef.current < events.length && events[eventIndexRef.current]!.t <= ms) {
      boardRef.current.apply(events[eventIndexRef.current]!);
      eventIndexRef.current++;
    }
    bump((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let url = packageUrl ?? null;
        if (!url && whiteboardId) {
          const res = await fetch(`/api/whiteboards/${whiteboardId}`);
          if (!res.ok) throw new Error("PLAYBACK_URL_FAILED");
          const data = await res.json();
          url = data.playback?.packageUrl ?? null;
        }
        if (!url) throw new Error("NO_PACKAGE_URL");
        const bin = await fetch(url);
        if (!bin.ok) throw new Error("PACKAGE_DOWNLOAD_FAILED");
        const buf = await bin.arrayBuffer();
        const parsed = await parseUbrdPackage(buf);
        if (cancelled) return;
        engineRef.current.load(parsed.events);
        boardRef.current.reset();
        boardRef.current.theme = parsed.manifest.theme;
        const blob = new Blob([parsed.audioBytes.buffer as ArrayBuffer], {
          type: parsed.audioFileName.endsWith(".m4a") ? "audio/mp4" : "audio/webm",
        });
        const objectUrl = URL.createObjectURL(blob);
        audioUrlRef.current = objectUrl;
        setPkg(parsed);
        setDurationMs(parsed.manifest.durationMs);
        setLoading(false);
        const clipStart = startMs != null ? startMs : initialPositionSec * 1000;
        requestAnimationFrame(() => {
          if (audioRef.current) {
            audioRef.current.src = objectUrl;
            audioRef.current.load();
            if (clipStart > 0) {
              audioRef.current.currentTime = clipStart / 1000;
              applyUntil(clipStart);
              setPlayheadMs(clipStart);
            } else {
              applyUntil(0);
            }
            if (autoPlay) {
              void audioRef.current.play().then(() => setPlaying(true)).catch(() => {});
            }
          }
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [packageUrl, whiteboardId, initialPositionSec, startMs, autoPlay, applyUntil]);

  useEffect(() => {
    paint();
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio || !pkg) return;
      const ms = Math.floor(audio.currentTime * 1000);
      setPlayheadMs(ms);
      applyForward(ms);
      if (endMs != null && ms >= endMs) {
        audio.pause();
        setPlaying(false);
        setPlayheadMs(endMs);
      }
      if (freePreviewSec && freePreviewSec > 0 && ms >= freePreviewSec * 1000) {
        audio.pause();
        setPlaying(false);
      }
      const dur = Math.max(1, Math.round(durationMs / 1000));
      const pos = Math.round(ms / 1000);
      onProgress?.(pos, dur, pos >= dur * 0.9);
    }, 100);
    return () => window.clearInterval(id);
  }, [pkg, applyForward, freePreviewSec, durationMs, onProgress, endMs]);

  const seek = async (ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(durationMs, ms));
    audio.currentTime = clamped / 1000;
    setPlayheadMs(clamped);
    applyUntil(clamped);
  };

  const label = useMemo(() => {
    const fmt = (ms: number) => {
      const s = Math.floor(ms / 1000);
      return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    return `${fmt(playheadMs)} / ${fmt(durationMs)}`;
  }, [playheadMs, durationMs]);

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted">Loading whiteboard…</div>;
  }
  if (error) {
    return <div className="flex h-64 items-center justify-center text-sm text-red-600">{error}</div>;
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-card-border bg-card">
      {title && <div className="border-b border-card-border px-3 py-2 text-sm font-semibold">{title}</div>}
      <div className={`relative w-full bg-black/5 ${compact ? "aspect-video max-h-56" : "aspect-video"}`}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <audio ref={audioRef} className="hidden" />
      </div>
      {!compact ? (
      <div className="space-y-2 p-3">
        <input
          type="range"
          className="w-full"
          min={0}
          max={Math.max(1, durationMs)}
          value={playheadMs}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg bg-black/10 px-2 py-1 text-xs"
            onClick={() => seek(playheadMs - 10000)}
          >
            -10s
          </button>
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
            onClick={async () => {
              const audio = audioRef.current;
              if (!audio) return;
              if (playing) {
                audio.pause();
                setPlaying(false);
              } else {
                audio.playbackRate = speed;
                await audio.play();
                setPlaying(true);
              }
            }}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-black/10 px-2 py-1 text-xs"
            onClick={() => seek(playheadMs + 10000)}
          >
            +10s
          </button>
          <select
            className="rounded-lg border border-card-border bg-transparent px-2 py-1 text-xs"
            value={speed}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSpeed(v);
              if (audioRef.current) audioRef.current.playbackRate = v;
            }}
          >
            {[0.75, 1, 1.25, 1.5, 2].map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <span className="ml-auto text-xs text-muted">{label}</span>
        </div>
      </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] text-muted">
          <button
            type="button"
            className="rounded bg-blue-600 px-2 py-0.5 text-white"
            onClick={async () => {
              const audio = audioRef.current;
              if (!audio) return;
              if (playing) {
                audio.pause();
                setPlaying(false);
              } else {
                if (startMs != null) {
                  audio.currentTime = startMs / 1000;
                  applyUntil(startMs);
                }
                await audio.play();
                setPlaying(true);
              }
            }}
          >
            {playing ? "Pause" : "Play clip"}
          </button>
          <span>{label}</span>
        </div>
      )}
    </div>
  );
}
