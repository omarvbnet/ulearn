"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardState } from "@/lib/whiteboard/board-state";
import { EventEngine } from "@/lib/whiteboard/event-engine";
import { parseUbrdPackage } from "@/lib/whiteboard/package";
import {
  LOGICAL_BOARD_HEIGHT,
  LOGICAL_BOARD_WIDTH,
  boardThemeColors,
  parseWhiteboardTheme,
  type ParsedUbrdPackage,
} from "@/lib/whiteboard/types";
import { paintBoardSurface } from "@/lib/whiteboard/board-theme";
import { WhiteboardBrandIntro } from "@/components/whiteboard/whiteboard-brand-intro";

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

function paintSmoothStroke(
  ctx: CanvasRenderingContext2D,
  stroke: {
    points: { x: number; y: number }[];
    color: string;
    opacity: number;
    width: number;
  }
) {
  if (!stroke.points.length) return;
  ctx.beginPath();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.globalAlpha = stroke.opacity;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const pts = stroke.points;
  if (pts.length === 1) {
    const p0 = pts[0]!;
    ctx.arc(p0.x, p0.y, Math.max(stroke.width / 2, 2.5), 0, Math.PI * 2);
    ctx.fill();
  } else if (pts.length === 2) {
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    ctx.lineTo(pts[1]!.x, pts[1]!.y);
    ctx.stroke();
  } else {
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i]!.x + pts[i + 1]!.x) / 2;
      const midY = (pts[i]!.y + pts[i + 1]!.y) / 2;
      ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, midX, midY);
    }
    const last = pts[pts.length - 1]!;
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

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
  const playingRef = useRef(false);
  const lastPaintRev = useRef(-1);
  const viewZoomRef = useRef(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pkg, setPkg] = useState<ParsedUbrdPackage | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [showIntro, setShowIntro] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  const [, bump] = useState(0);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    viewZoomRef.current = viewZoom;
    bump((n) => n + 1);
  }, [viewZoom]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const parsed = pkg;
    if (!canvas || !parsed) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const nextW = Math.max(1, Math.floor(rect.width * dpr));
    const nextH = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bw = parsed.manifest.boardWidth || LOGICAL_BOARD_WIDTH;
    const bh = parsed.manifest.boardHeight || LOGICAL_BOARD_HEIGHT;
    const zoom = viewZoomRef.current;
    const fit = Math.min(rect.width / bw, rect.height / bh);
    const scale = fit * zoom;
    const dx = (rect.width - bw * scale) / 2;
    const dy = (rect.height - bh * scale) / 2;
    const board = boardRef.current;
    const theme = parseWhiteboardTheme(board.theme);
    const chrome = boardThemeColors(theme);

    ctx.fillStyle = chrome.chromeBg;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.scale(scale, scale);
    paintBoardSurface(ctx, theme, bw, bh);

    const page = board.currentPage;
    if (page) {
      for (const shape of page.shapes) {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.width;
        ctx.lineCap = "round";
        ctx.beginPath();
        if (shape.kind === "circle") {
          ctx.lineJoin = "round";
          ctx.ellipse(
            (shape.x1 + shape.x2) / 2,
            (shape.y1 + shape.y2) / 2,
            Math.abs(shape.x2 - shape.x1) / 2,
            Math.abs(shape.y2 - shape.y1) / 2,
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        } else if (shape.kind === "line") {
          ctx.lineJoin = "round";
          ctx.moveTo(shape.x1, shape.y1);
          ctx.lineTo(shape.x2, shape.y2);
          ctx.stroke();
        } else if (shape.kind === "arrow") {
          ctx.lineJoin = "round";
          ctx.moveTo(shape.x1, shape.y1);
          ctx.lineTo(shape.x2, shape.y2);
          ctx.stroke();
          const dx = shape.x2 - shape.x1;
          const dy = shape.y2 - shape.y1;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const head = Math.max(shape.width * 3.2, 14);
          const px = -uy;
          const py = ux;
          ctx.beginPath();
          ctx.moveTo(shape.x2, shape.y2);
          ctx.lineTo(shape.x2 - ux * head + px * head * 0.45, shape.y2 - uy * head + py * head * 0.45);
          ctx.lineTo(shape.x2 - ux * head - px * head * 0.45, shape.y2 - uy * head - py * head * 0.45);
          ctx.closePath();
          ctx.fillStyle = shape.color;
          ctx.fill();
        } else {
          // rect / rectangle / default
          ctx.lineJoin = "miter";
          ctx.miterLimit = 4;
          ctx.rect(shape.x1, shape.y1, shape.x2 - shape.x1, shape.y2 - shape.y1);
          ctx.stroke();
        }
      }
      for (const stroke of page.strokes) paintSmoothStroke(ctx, stroke);
      for (const stroke of board.getOpenStrokes()) {
        if (stroke.pageId === page.id) paintSmoothStroke(ctx, stroke);
      }
      for (const text of page.texts) {
        ctx.fillStyle = text.color;
        ctx.font = `${text.fontSize}px system-ui, sans-serif`;
        ctx.fillText(text.text, text.x, text.y);
      }
      if (board.laser?.visible && board.laser.pageId === page.id) {
        const g = ctx.createRadialGradient(
          board.laser.x,
          board.laser.y,
          0,
          board.laser.x,
          board.laser.y,
          14
        );
        g.addColorStop(0, "rgba(255,107,107,0.95)");
        g.addColorStop(1, "rgba(239,68,68,0)");
        ctx.beginPath();
        ctx.fillStyle = g;
        ctx.arc(board.laser.x, board.laser.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = "rgba(239,68,68,0.95)";
        ctx.arc(board.laser.x, board.laser.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    lastPaintRev.current = board.revision;
  }, [pkg]);

  const applyUntil = useCallback(
    (ms: number) => {
      boardRef.current.reset();
      if (pkg) boardRef.current.theme = pkg.manifest.theme;
      eventIndexRef.current = 0;
      const events = engineRef.current.all;
      while (eventIndexRef.current < events.length && events[eventIndexRef.current]!.t <= ms) {
        boardRef.current.apply(events[eventIndexRef.current]!);
        eventIndexRef.current++;
      }
      boardRef.current.normalizeCurrentPageForDisplay();
    },
    [pkg]
  );

  const applyForward = useCallback((ms: number) => {
    const events = engineRef.current.all;
    let applied = false;
    while (eventIndexRef.current < events.length && events[eventIndexRef.current]!.t <= ms) {
      boardRef.current.apply(events[eventIndexRef.current]!);
      eventIndexRef.current++;
      applied = true;
    }
    if (applied) boardRef.current.normalizeCurrentPageForDisplay();
    return applied;
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
        const wantIntro = !compact && startMs == null && initialPositionSec < 3;
        setShowIntro(wantIntro);
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
            paint();
            if (autoPlay && !wantIntro) {
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
  }, [packageUrl, whiteboardId, initialPositionSec, startMs, autoPlay, applyUntil, compact, paint]);

  const finishIntro = useCallback(() => {
    setShowIntro(false);
    if (!autoPlay) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    void audio.play().then(() => setPlaying(true)).catch(() => {});
  }, [autoPlay, speed]);

  useEffect(() => {
    paint();
  });

  // Audio-synced rAF clock (~60fps) instead of 100ms polling.
  useEffect(() => {
    let raf = 0;
    let lastProgressAt = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio && pkg) {
        const ms = Math.floor(audio.currentTime * 1000);
        setPlayheadMs(ms);
        applyForward(ms);
        if (boardRef.current.revision !== lastPaintRev.current) {
          paint();
        }
        if (endMs != null && ms >= endMs) {
          audio.pause();
          setPlaying(false);
          setPlayheadMs(endMs);
        }
        if (freePreviewSec && freePreviewSec > 0 && ms >= freePreviewSec * 1000) {
          audio.pause();
          setPlaying(false);
        }
        if (playingRef.current && ms - lastProgressAt >= 1000) {
          lastProgressAt = ms;
          const dur = Math.max(1, Math.round(durationMs / 1000));
          const pos = Math.round(ms / 1000);
          onProgress?.(pos, dur, pos >= dur * 0.9);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pkg, applyForward, freePreviewSec, durationMs, onProgress, endMs, paint]);

  const seek = async (ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(durationMs, ms));
    audio.currentTime = clamped / 1000;
    setPlayheadMs(clamped);
    applyUntil(clamped);
    paint();
  };

  const nudgeZoom = (factor: number) => {
    setViewZoom((z) => Math.min(5, Math.max(1, Number((z * factor).toFixed(2)))));
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
        {showIntro && (
          <WhiteboardBrandIntro lessonTitle={title} onFinished={finishIntro} />
        )}
        {!compact && viewZoom > 1.05 && (
          <button
            type="button"
            className="absolute right-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white"
            onClick={() => setViewZoom(1)}
          >
            {viewZoom.toFixed(1)}× Reset
          </button>
        )}
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
          <button
            type="button"
            className="rounded-lg bg-black/10 px-2 py-1 text-xs"
            onClick={() => nudgeZoom(1 / 1.35)}
          >
            Zoom −
          </button>
          <button
            type="button"
            className="rounded-lg bg-black/10 px-2 py-1 text-xs"
            onClick={() => nudgeZoom(1.35)}
          >
            Zoom +
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
                  paint();
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
