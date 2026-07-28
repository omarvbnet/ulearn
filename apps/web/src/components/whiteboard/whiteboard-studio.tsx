"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { BoardState } from "@/lib/whiteboard/board-state";
import { EventEngine } from "@/lib/whiteboard/event-engine";
import { buildUbrdPackage, parseUbrdPackage } from "@/lib/whiteboard/package";
import { spliceAudioBlob } from "@/lib/whiteboard/audio-edit";
import {
  markDirtyRange,
  type WhiteboardEditRange,
} from "@/lib/whiteboard/edit-diff";
import {
  LOGICAL_BOARD_HEIGHT,
  LOGICAL_BOARD_WIDTH,
  boardThemeColors,
  nextWhiteboardTheme,
  parseWhiteboardTheme,
  type WhiteboardThemeId,
  type WhiteboardTool,
} from "@/lib/whiteboard/types";
import { defaultOpacityForTool, resolveStrokeWidth, STROKE_WIDTH_PRESETS, smoothStrokePoints } from "@/lib/whiteboard/smoothing";
import { paintBoardSurface } from "@/lib/whiteboard/board-theme";

type Props = {
  courseId: string;
  initialTitle?: string;
  lessonId?: string;
  whiteboardId?: string;
  onPublished?: (result?: { pendingReview?: boolean }) => void;
  onCancel?: () => void;
};

const TOOLS: { id: WhiteboardTool; label: string }[] = [
  { id: "pen", label: "Pen" },
  { id: "pencil", label: "Pencil" },
  { id: "highlighter", label: "Highlight" },
  { id: "eraser", label: "Eraser" },
  { id: "text", label: "Text" },
  { id: "laser", label: "Laser" },
  { id: "rect", label: "Rect" },
  { id: "circle", label: "Circle" },
  { id: "line", label: "Line" },
  { id: "arrow", label: "Arrow" },
  { id: "select", label: "Select" },
];

const COLORS = ["#111827", "#EF4444", "#2563EB", "#22C55E", "#F59E0B", "#F8FAFC"];

function uid() {
  return `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function fmtMs(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function WhiteboardStudio({
  courseId,
  initialTitle,
  lessonId,
  whiteboardId,
  onPublished,
  onCancel,
}: Props) {
  const editMode = Boolean(lessonId && whiteboardId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(new EventEngine());
  const boardRef = useRef(new BoardState());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const activeStrokeRef = useRef<{ id: string; points: { x: number; y: number; p?: number }[] } | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const activePointersRef = useRef(new Set<number>());
  const zoomGestureRef = useRef(false);
  const draftShapeRef = useRef<{
    id: string;
    pageId: string;
    kind: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    width: number;
  } | null>(null);
  const undoStackRef = useRef<{ kind: string; payload: Record<string, unknown> }[]>([]);
  const redoStackRef = useRef<{ kind: string; payload: Record<string, unknown> }[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const draftTimer = useRef<number | null>(null);
  const pdfsRef = useRef<
    { assetId: string; materialId?: string; fileKey?: string; fileUrl?: string; title: string }[]
  >([]);
  const audioBlobRef = useRef<Blob | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const previousDurationRef = useRef(0);

  const [title, setTitle] = useState(initialTitle || "Whiteboard lesson");
  const [theme, setTheme] = useState<WhiteboardThemeId>("WHITE");
  const [tool, setTool] = useState<WhiteboardTool>("pen");
  const [color, setColor] = useState("#111827");
  const [strokeWidth, setStrokeWidth] = useState(3.5);
  const [viewZoom, setViewZoom] = useState(1);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(editMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [trimIn, setTrimIn] = useState<number | null>(null);
  const [trimOut, setTrimOut] = useState<number | null>(null);
  const [dirtyRanges, setDirtyRanges] = useState<WhiteboardEditRange[]>([]);
  const [pageIds, setPageIds] = useState<string[]>(["page_0"]);
  const [currentPageId, setCurrentPageId] = useState("page_0");
  const [, bump] = useState(0);
  const redraw = useCallback(() => bump((n) => n + 1), []);

  const colors = boardThemeColors(theme);
  const boardBg = colors.surface;
  const chromeBg = colors.chromeBg;
  const chromeFg = colors.chromeFg;

  const markDirty = useCallback(
    (startMs: number, endMs: number, kind: WhiteboardEditRange["kind"] = "redraw") => {
      if (!editMode) return;
      setDirtyRanges((prev) => markDirtyRange(prev, startMs, endMs, kind));
    },
    [editMode]
  );

  const emitEvent = useCallback(
    (type: Parameters<EventEngine["push"]>[0], payload: Record<string, unknown>) => {
      const engine = engineRef.current;
      if (recording) {
        engine.push(type, payload);
        return;
      }
      if (editMode) {
        engine.pushAt(playheadMs, type, payload);
        markDirty(playheadMs, playheadMs + 50, "redraw");
      }
    },
    [recording, editMode, playheadMs, markDirty]
  );

  const seekPreview = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(durationMs || previousDurationRef.current, ms));
      setPlayheadMs(clamped);
      setElapsed(clamped);
      boardRef.current.reset();
      boardRef.current.theme = theme;
      boardRef.current.applyEvents(engineRef.current.eventsUpTo(clamped));
      setPageIds(boardRef.current.pages.map((p) => p.id));
      setCurrentPageId(boardRef.current.currentPageId ?? "page_0");
      const audio = audioPreviewRef.current;
      if (audio) audio.currentTime = clamped / 1000;
      redraw();
    },
    [durationMs, theme, redraw]
  );

  useEffect(() => {
    if (!editMode || !whiteboardId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingEdit(true);
        const res = await fetch(`/api/whiteboards/${whiteboardId}`);
        if (!res.ok) throw new Error("Could not load whiteboard");
        const data = await res.json();
        const url = data.playback?.packageUrl as string | undefined;
        if (!url) throw new Error("No package URL");
        const bin = await fetch(url);
        if (!bin.ok) throw new Error("Package download failed");
        const parsed = await parseUbrdPackage(await bin.arrayBuffer());
        if (cancelled) return;
        engineRef.current.load(parsed.events);
        boardRef.current.reset();
        boardRef.current.theme = parsed.manifest.theme;
        boardRef.current.applyEvents(parsed.events);
        pdfsRef.current = (parsed.assets.pdfs ?? []).map((p) => ({
          assetId: p.assetId,
          materialId: p.materialId,
          fileKey: p.fileKey,
          fileUrl: p.fileUrl,
          title: p.title,
        }));
        const mime = parsed.audioFileName.toLowerCase().endsWith(".m4a")
          ? "audio/mp4"
          : "audio/webm";
        audioBlobRef.current = new Blob([parsed.audioBytes.buffer as ArrayBuffer], { type: mime });
        previousDurationRef.current = parsed.manifest.durationMs;
        setTheme(parseWhiteboardTheme(parsed.manifest.theme));
        setColor(boardThemeColors(parseWhiteboardTheme(parsed.manifest.theme)).defaultInk);
        setDurationMs(parsed.manifest.durationMs);
        setElapsed(parsed.manifest.durationMs);
        setPlayheadMs(0);
        setPageIds(boardRef.current.pages.map((p) => p.id));
        setCurrentPageId(boardRef.current.currentPageId ?? "page_0");
        if (initialTitle) setTitle(initialTitle);
        boardRef.current.reset();
        boardRef.current.theme = parsed.manifest.theme;
        boardRef.current.applyEvents(engineRef.current.eventsUpTo(0));
        redraw();
        setLoadingEdit(false);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Load failed");
          setLoadingEdit(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editMode, whiteboardId, initialTitle, redraw]);

  useEffect(() => {
    if (!previewPlaying) return;
    const id = window.setInterval(() => {
      const audio = audioPreviewRef.current;
      if (!audio) return;
      const ms = Math.floor(audio.currentTime * 1000);
      setPlayheadMs(ms);
      setElapsed(ms);
      boardRef.current.reset();
      boardRef.current.theme = theme;
      boardRef.current.applyEvents(engineRef.current.eventsUpTo(ms));
      redraw();
      if (audio.ended || ms >= durationMs) setPreviewPlaying(false);
    }, 80);
    return () => window.clearInterval(id);
  }, [previewPlaying, durationMs, theme, redraw]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    const fit = Math.min(rect.width / LOGICAL_BOARD_WIDTH, rect.height / LOGICAL_BOARD_HEIGHT);
    const scale = fit * viewZoom;
    const dx = (rect.width - LOGICAL_BOARD_WIDTH * scale) / 2;
    const dy = (rect.height - LOGICAL_BOARD_HEIGHT * scale) / 2;
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = chromeBg;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.scale(scale, scale);
    paintBoardSurface(ctx, theme);
    const board = boardRef.current;
    const page = board.currentPage;
    if (page) {
      const drawShape = (
        shape: {
          kind: string;
          x1: number;
          y1: number;
          x2: number;
          y2: number;
          color: string;
          width: number;
        },
        preview = false
      ) => {
        ctx.strokeStyle = shape.color;
        ctx.globalAlpha = preview ? 0.85 : 1;
        ctx.lineWidth = shape.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
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
        if (preview) {
          const w = Math.abs(shape.x2 - shape.x1);
          const h = Math.abs(shape.y2 - shape.y1);
          const label =
            shape.kind === "line" || shape.kind === "arrow"
              ? `${Math.round(Math.hypot(w, h))} px`
              : `${Math.round(w)} × ${Math.round(h)}`;
          ctx.font = "600 22px system-ui, sans-serif";
          ctx.fillStyle = shape.color;
          ctx.fillText(label, Math.max(shape.x1, shape.x2) + 8, Math.min(shape.y1, shape.y2) - 8);
        }
        ctx.globalAlpha = 1;
      };
      for (const shape of page.shapes) drawShape(shape);
      if (draftShapeRef.current && draftShapeRef.current.pageId === page.id) {
        drawShape(draftShapeRef.current, true);
      }
      const paintStroke = (stroke: (typeof page.strokes)[number]) => {
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
      };
      for (const stroke of page.strokes) paintStroke(stroke);
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
  }, [boardBg, chromeBg, viewZoom]);

  useEffect(() => {
    paint();
  });

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setElapsed(engineRef.current.now()), 200);
    draftTimer.current = window.setInterval(() => {
      try {
        localStorage.setItem(
          `wb_draft_${courseId}`,
          JSON.stringify({
            events: engineRef.current.all,
            theme,
            title,
            savedAt: new Date().toISOString(),
          })
        );
      } catch {
        /* ignore */
      }
    }, 20000);
    return () => {
      window.clearInterval(id);
      if (draftTimer.current) window.clearInterval(draftTimer.current);
    };
  }, [recording, courseId, theme, title]);

  const toLogical = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const fit = Math.min(rect.width / LOGICAL_BOARD_WIDTH, rect.height / LOGICAL_BOARD_HEIGHT);
    const scale = fit * viewZoom;
    const dx = (rect.width - LOGICAL_BOARD_WIDTH * scale) / 2;
    const dy = (rect.height - LOGICAL_BOARD_HEIGHT * scale) / 2;
    const x = (e.clientX - rect.left - dx) / scale;
    const y = (e.clientY - rect.top - dy) / scale;
    return {
      x: Math.max(0, Math.min(LOGICAL_BOARD_WIDTH, x)),
      y: Math.max(0, Math.min(LOGICAL_BOARD_HEIGHT, y)),
      p: e.pressure > 0 ? e.pressure : 0.5,
    };
  };

  const nudgeViewZoom = (factor: number) => {
    zoomGestureRef.current = true;
    discardInProgressInk();
    setViewZoom((z) => Math.min(5, Math.max(1, Number((z * factor).toFixed(2)))));
    window.setTimeout(() => {
      zoomGestureRef.current = false;
    }, 180);
  };

  const discardInProgressInk = () => {
    const active = activeStrokeRef.current;
    if (active) {
      const page = boardRef.current.currentPage;
      if (page) page.strokes = page.strokes.filter((s) => s.id !== active.id);
      emitEvent("erase", {
        pageId: boardRef.current.currentPageId ?? "page_0",
        strokeIds: [active.id],
      });
      activeStrokeRef.current = null;
    }
    const draft = draftShapeRef.current;
    if (draft) {
      emitEvent("shape_delete", { shapeId: draft.id });
      const page = boardRef.current.currentPage;
      if (page) page.shapes = page.shapes.filter((s) => s.id !== draft.id);
      draftShapeRef.current = null;
      shapeStartRef.current = null;
    }
    if (boardRef.current.laser?.visible) {
      const pageId = boardRef.current.currentPageId ?? "page_0";
      boardRef.current.laser = { pageId, x: 0, y: 0, visible: false };
      emitEvent("laser_move", { pageId, x: 0, y: 0, visible: false });
    }
    redraw();
  };

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (ev) => {
      if (ev.data.size) chunksRef.current.push(ev.data);
    };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    const engine = engineRef.current;
    if (editMode && durationMs > 0) {
      engine.resumeAt(durationMs);
      markDirty(durationMs, durationMs + 1, "audio");
    } else {
      engine.start();
      engine.push("session_start", {
        theme,
        boardWidth: LOGICAL_BOARD_WIDTH,
        boardHeight: LOGICAL_BOARD_HEIGHT,
      });
      engine.push("page_select", { pageId: currentPageId });
      setElapsed(0);
    }
    setRecording(true);
    setPreviewPlaying(false);
  };

  const cutSelection = async () => {
    if (trimIn == null || trimOut == null) return;
    const lo = Math.min(trimIn, trimOut);
    const hi = Math.max(trimIn, trimOut);
    if (hi - lo < 100) return;
    const removed = engineRef.current.cutRange(lo, hi);
    if (audioBlobRef.current) {
      const spliced = await spliceAudioBlob(audioBlobRef.current, lo, hi);
      audioBlobRef.current = spliced.blob;
    }
    const nextDur = Math.max(0, durationMs - removed);
    setDurationMs(nextDur);
    setDirtyRanges((prev) => {
      const marked = markDirtyRange(prev, lo, lo, "trim");
      return marked.map((r) =>
        r.kind === "trim" && Math.abs(r.startMs - lo) < 2000 ? { ...r, removedMs: removed } : r
      );
    });
    setTrimIn(null);
    setTrimOut(null);
    seekPreview(Math.min(lo, nextDur));
  };

  const uploadAndFinish = async (packageBytes: Uint8Array, durationMsFinal: number) => {
    const uploadRes = await fetch("/api/whiteboards/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId,
        filename: "lesson.ubrd",
        contentType: "application/octet-stream",
        size: packageBytes.byteLength,
        theme,
      }),
    });
    if (!uploadRes.ok) throw new Error("UPLOAD_URL_FAILED");
    const upload = await uploadRes.json();
    const put = await fetch(upload.uploadUrl as string, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: packageBytes.buffer.slice(
        packageBytes.byteOffset,
        packageBytes.byteOffset + packageBytes.byteLength
      ) as ArrayBuffer,
    });
    if (!put.ok) throw new Error("UPLOAD_FAILED");
    const complete = await fetch("/api/whiteboards/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        whiteboardId: upload.whiteboardId,
        size: packageBytes.byteLength,
        durationSec: Math.ceil(durationMsFinal / 1000),
        theme,
        schemaVersion: 1,
      }),
    });
    if (!complete.ok) throw new Error("COMPLETE_FAILED");

    if (editMode && lessonId) {
      const patch = await fetch(`/api/teacher/courses/${courseId}/lessons/${lessonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whiteboardAssetId: upload.whiteboardId,
          durationSec: Math.ceil(durationMsFinal / 1000),
          fileKey: upload.objectKey,
          editDiff: {
            ranges: dirtyRanges,
            previousDurationMs: previousDurationRef.current,
            newDurationMs: durationMsFinal,
          },
        }),
      });
      if (!patch.ok) throw new Error("LESSON_UPDATE_FAILED");
      const body = await patch.json();
      localStorage.removeItem(`wb_draft_${courseId}`);
      onPublished?.({ pendingReview: Boolean(body.pendingReview) });
      return;
    }

    const lesson = await fetch(`/api/teacher/courses/${courseId}/lessons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim() || "Whiteboard lesson",
        lessonType: "WHITEBOARD",
        whiteboardAssetId: upload.whiteboardId,
        durationSec: Math.ceil(durationMsFinal / 1000),
        fileKey: upload.objectKey,
      }),
    });
    if (!lesson.ok) throw new Error("LESSON_CREATE_FAILED");
    localStorage.removeItem(`wb_draft_${courseId}`);
    onPublished?.({ pendingReview: false });
  };

  const stopAndPublish = async () => {
    if (saving) return;
    setSaving(true);
    try {
      let durationMsFinal = durationMs;
      if (recording) {
        const recorder = mediaRecorderRef.current;
        const newBlob = await new Promise<Blob>((resolve, reject) => {
          if (!recorder) return reject(new Error("NO_RECORDER"));
          recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
          recorder.stop();
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        if (editMode && audioBlobRef.current) {
          audioBlobRef.current = new Blob([audioBlobRef.current, newBlob], { type: "audio/webm" });
          durationMsFinal = engineRef.current.now();
          engineRef.current.stop(durationMsFinal);
        } else {
          durationMsFinal = engineRef.current.stop();
          audioBlobRef.current = newBlob;
        }
        setRecording(false);
      } else if (editMode) {
        durationMsFinal =
          durationMs ||
          (engineRef.current.all.length
            ? engineRef.current.all[engineRef.current.all.length - 1]!.t
            : previousDurationRef.current);
      } else {
        throw new Error("Nothing to publish");
      }
      if (!audioBlobRef.current) throw new Error("AUDIO_MISSING");
      const audioBytes = new Uint8Array(await audioBlobRef.current.arrayBuffer());
      const packageBytes = await buildUbrdPackage({
        engine: engineRef.current,
        audioBytes,
        audioFileName: "audio.webm",
        audioCodec: "opus",
        theme,
        pageCount: boardRef.current.pages.length,
        durationMs: durationMsFinal,
        assets: { pdfs: pdfsRef.current },
      });
      await uploadAndFinish(packageBytes, durationMsFinal);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setRecording(false);
      setSaving(false);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    // Mouse/pen are always single-pointer — clear stuck multi-touch state.
    if (e.pointerType === "mouse" || e.pointerType === "pen") {
      activePointersRef.current = new Set([e.pointerId]);
      zoomGestureRef.current = false;
    } else {
      activePointersRef.current.add(e.pointerId);
    }
    const drawingBlocked =
      zoomGestureRef.current || activePointersRef.current.size >= 2;
    if (drawingBlocked) {
      discardInProgressInk();
      return;
    }
    if (tool === "select") {
      return;
    }
    const pt = toLogical(e);
    const pageId = boardRef.current.currentPageId ?? "page_0";
    if (!(recording || editMode)) return;

    if (tool === "laser") {
      boardRef.current.laser = { pageId, x: pt.x, y: pt.y, visible: true };
      emitEvent("laser_move", { pageId, x: pt.x, y: pt.y, visible: true });
      redraw();
      return;
    }
    if (tool === "text") {
      const text = window.prompt("Text");
      if (!text?.trim()) return;
      const textId = uid();
      const payload = { textId, pageId, x: pt.x, y: pt.y, text: text.trim(), color, fontSize: 28 };
      const t = recording ? engineRef.current.now() : playheadMs;
      boardRef.current.apply({ id: textId, t, type: "text_insert", payload });
      emitEvent("text_insert", payload);
      redraw();
      return;
    }
    if (tool === "rect" || tool === "circle" || tool === "line" || tool === "arrow") {
      const id = uid();
      shapeStartRef.current = { x: pt.x, y: pt.y, id };
      draftShapeRef.current = {
        id,
        pageId,
        kind: tool === "rect" ? "rect" : tool,
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
        color,
        width: Math.min(8, Math.max(1.5, resolveStrokeWidth("pen", strokeWidth))),
      };
      emitEvent("shape_add", {
        shapeId: id,
        pageId,
        kind: tool === "rect" ? "rect" : tool,
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
        color,
        width: Math.min(8, Math.max(1.5, resolveStrokeWidth("pen", strokeWidth))),
      });
      redraw();
      return;
    }
    if (tool === "eraser") {
      const page = boardRef.current.currentPage;
      if (!page) return;
      const hit = page.strokes
        .filter((s) => s.points.some((p) => (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2 < 400))
        .map((s) => s.id);
      if (!hit.length) return;
      page.strokes = page.strokes.filter((s) => !hit.includes(s.id));
      emitEvent("erase", { pageId, strokeIds: hit });
      redraw();
      return;
    }

    const strokeId = uid();
    const width = resolveStrokeWidth(tool, strokeWidth);
    activeStrokeRef.current = { id: strokeId, points: [{ x: pt.x, y: pt.y, p: pt.p }] };
    emitEvent("stroke_begin", {
      strokeId,
      pageId,
      tool,
      color,
      opacity: defaultOpacityForTool(tool),
      width,
    });
    emitEvent("stroke_point", { strokeId, x: pt.x, y: pt.y, p: pt.p });
    const page = boardRef.current.currentPage;
    if (page) {
      page.strokes.push({
        id: strokeId,
        pageId,
        tool,
        color,
        opacity: defaultOpacityForTool(tool),
        width,
        points: [{ x: pt.x, y: pt.y, p: pt.p }],
      });
    }
    redraw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (zoomGestureRef.current || activePointersRef.current.size >= 2) {
      discardInProgressInk();
      return;
    }
    if (tool === "select") {
      return;
    }
    const pt = toLogical(e);
    const pageId = boardRef.current.currentPageId ?? "page_0";
    if (!(recording || editMode)) return;
    if (tool === "laser") {
      boardRef.current.laser = { pageId, x: pt.x, y: pt.y, visible: true };
      emitEvent("laser_move", { pageId, x: pt.x, y: pt.y, visible: true });
      redraw();
      return;
    }
    const draft = draftShapeRef.current;
    const shapeStart = shapeStartRef.current;
    if (draft && shapeStart) {
      draft.x2 = pt.x;
      draft.y2 = pt.y;
      emitEvent("shape_update", {
        shapeId: draft.id,
        x1: shapeStart.x,
        y1: shapeStart.y,
        x2: pt.x,
        y2: pt.y,
      });
      redraw();
      return;
    }
    const active = activeStrokeRef.current;
    if (!active) return;
    active.points.push({ x: pt.x, y: pt.y, p: pt.p });
    emitEvent("stroke_point", { strokeId: active.id, x: pt.x, y: pt.y, p: pt.p });
    const page = boardRef.current.currentPage;
    if (page) {
      const existing = page.strokes.find((s) => s.id === active.id);
      if (existing) existing.points = active.points.map((p) => ({ ...p }));
      else {
        page.strokes.push({
          id: active.id,
          pageId,
          tool,
          color,
          opacity: defaultOpacityForTool(tool),
          width: resolveStrokeWidth(tool, strokeWidth),
          points: active.points.map((p) => ({ ...p })),
        });
      }
    }
    redraw();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    const othersDown = activePointersRef.current.size > 0;
    if (zoomGestureRef.current || othersDown) {
      discardInProgressInk();
      if (!othersDown) zoomGestureRef.current = false;
      return;
    }
    zoomGestureRef.current = false;
    if (tool === "select") {
      return;
    }
    const pt = toLogical(e);
    const pageId = boardRef.current.currentPageId ?? "page_0";
    const shape = shapeStartRef.current;
    if (shape && (tool === "rect" || tool === "circle" || tool === "line" || tool === "arrow")) {
      const fixed = {
        shapeId: shape.id,
        pageId,
        kind: tool === "rect" ? "rect" : tool,
        x1: shape.x,
        y1: shape.y,
        x2: pt.x,
        y2: pt.y,
        color,
        width: draftShapeRef.current?.width ?? Math.min(8, Math.max(1.5, resolveStrokeWidth("pen", strokeWidth))),
      };
      const t = recording ? engineRef.current.now() : playheadMs;
      boardRef.current.apply({ id: shape.id, t, type: "shape_add", payload: fixed });
      emitEvent("shape_update", fixed);
      undoStackRef.current.push({ kind: "shape", payload: { shapeId: shape.id, pageId } });
      redoStackRef.current = [];
      setHistoryTick((n) => n + 1);
      shapeStartRef.current = null;
      draftShapeRef.current = null;
      redraw();
      return;
    }
    const active = activeStrokeRef.current;
    if (!active) return;
    const points =
      active.points.length > 1 ? smoothStrokePoints(active.points) : active.points;
    const page = boardRef.current.currentPage;
    if (page) {
      const existing = page.strokes.find((s) => s.id === active.id);
      if (existing) existing.points = points;
    }
    emitEvent("stroke_end", { strokeId: active.id, pageId, points });
    undoStackRef.current.push({ kind: "stroke", payload: { strokeId: active.id, pageId } });
    redoStackRef.current = [];
    setHistoryTick((n) => n + 1);
    activeStrokeRef.current = null;
    redraw();
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    discardInProgressInk();
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomGestureRef.current = true;
    discardInProgressInk();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    setViewZoom((z) => Math.min(5, Math.max(1, Number((z * factor).toFixed(2)))));
    window.setTimeout(() => {
      zoomGestureRef.current = false;
    }, 180);
  };

  const attachCoursePdf = async () => {
    try {
      const res = await fetch(`/api/teacher/courses/${courseId}/documents`);
      if (!res.ok) throw new Error("DOCS_FAILED");
      const data = await res.json();
      const docs = (data.documents ?? data.materials ?? []) as {
        id: string;
        title: string;
        type?: string;
        fileKey?: string;
        fileUrl?: string;
      }[];
      const pdfs = docs.filter((d) => (d.type ?? "PDF") === "PDF");
      if (!pdfs.length) {
        alert("No course PDF documents found. Upload one under course documents first.");
        return;
      }
      const labels = pdfs.map((p, i) => `${i + 1}. ${p.title}`).join("\n");
      const pick = window.prompt(`Select PDF number:\n${labels}`, "1");
      const idx = Math.max(0, (Number(pick) || 1) - 1);
      const chosen = pdfs[idx];
      if (!chosen) return;
      const assetId = `pdf_${chosen.id}`;
      pdfsRef.current = [
        ...pdfsRef.current.filter((p) => p.assetId !== assetId),
        {
          assetId,
          materialId: chosen.id,
          fileKey: chosen.fileKey,
          fileUrl: chosen.fileUrl,
          title: chosen.title,
        },
      ];
      const pageId = `page_${uid()}`;
      boardRef.current.addBlankPage(pageId);
      const page = boardRef.current.currentPage;
      if (page) {
        page.kind = "pdf";
        page.pdfAssetId = assetId;
        page.pdfPage = 1;
      }
      setPageIds(boardRef.current.pages.map((p) => p.id));
      setCurrentPageId(pageId);
      if (recording || editMode) {
        emitEvent("pdf_open", { assetId, title: chosen.title });
        emitEvent("page_add", {
          pageId,
          index: boardRef.current.pages.length - 1,
          kind: "pdf",
          pdfAssetId: assetId,
          pdfPage: 1,
        });
        emitEvent("page_select", { pageId });
      }
      redraw();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not attach PDF");
    }
  };

  const importDevicePdf = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf,.pdf";
      const file = await new Promise<File | null>((resolve) => {
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
      });
      if (!file) return;
      const presignRes = await fetch("/api/admin/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name.endsWith(".pdf") ? file.name : `${file.name}.pdf`,
          contentType: "application/pdf",
          folder: "course-materials",
        }),
      });
      if (!presignRes.ok) throw new Error("PRESIGN_FAILED");
      const presign = await presignRes.json();
      const uploadUrl = String(presign.uploadUrl ?? "");
      const key = String(presign.key ?? presign.fileKey ?? "");
      const publicUrl = String(presign.publicUrl ?? presign.url ?? "");
      if (!uploadUrl || !key) throw new Error("Upload URL missing");
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!put.ok) throw new Error("UPLOAD_FAILED");
      const docRes = await fetch(`/api/teacher/courses/${courseId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: file.name.replace(/\.pdf$/i, ""),
          fileKey: key,
          fileUrl: publicUrl || `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`,
          mimeType: "application/pdf",
          fileSize: file.size,
          type: "PDF",
        }),
      });
      if (!docRes.ok) throw new Error("DOCUMENT_SAVE_FAILED");
      const docJson = await docRes.json();
      const doc = docJson.document ?? {};
      const assetId = `pdf_${doc.id ?? uid()}`;
      pdfsRef.current = [
        ...pdfsRef.current.filter((p) => p.assetId !== assetId),
        {
          assetId,
          materialId: doc.id,
          fileKey: doc.fileKey ?? key,
          fileUrl: doc.fileUrl ?? publicUrl,
          title: doc.title ?? file.name,
        },
      ];
      const pageId = `page_${uid()}`;
      boardRef.current.addBlankPage(pageId);
      const page = boardRef.current.currentPage;
      if (page) {
        page.kind = "pdf";
        page.pdfAssetId = assetId;
        page.pdfPage = 1;
        page.pdfZoom = 1;
      }
      setPageIds(boardRef.current.pages.map((p) => p.id));
      setCurrentPageId(pageId);
      if (recording || editMode) {
        emitEvent("pdf_open", { assetId, title: doc.title ?? file.name });
        emitEvent("page_add", {
          pageId,
          index: boardRef.current.pages.length - 1,
          kind: "pdf",
          pdfAssetId: assetId,
          pdfPage: 1,
        });
        emitEvent("page_select", { pageId });
      }
      redraw();
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF import failed");
    }
  };

  const nudgePdfZoom = (factor: number) => {
    const page = boardRef.current.currentPage;
    if (!page || page.kind !== "pdf" || !page.pdfAssetId) return;
    const next = Math.min(5, Math.max(0.5, (page.pdfZoom ?? 1) * factor));
    page.pdfZoom = next;
    if (recording || editMode) {
      emitEvent("pdf_zoom", { assetId: page.pdfAssetId, zoom: next });
    }
    redraw();
  };

  const undo = () => {
    const item = undoStackRef.current.pop();
    if (!item) return;
    if (item.kind === "stroke") {
      const id = String(item.payload.strokeId ?? "");
      const pageId = String(item.payload.pageId ?? "");
      const page = boardRef.current.pages.find((p) => p.id === pageId) ?? boardRef.current.currentPage;
      const stroke = page?.strokes.find((s) => s.id === id);
      if (stroke) {
        redoStackRef.current.push({
          kind: "stroke",
          payload: {
            strokeId: stroke.id,
            pageId: stroke.pageId,
            tool: stroke.tool,
            color: stroke.color,
            opacity: stroke.opacity,
            width: stroke.width,
            points: stroke.points,
          },
        });
      }
      if (page) page.strokes = page.strokes.filter((s) => s.id !== id);
      emitEvent("erase", { pageId, strokeIds: [id] });
    } else if (item.kind === "shape") {
      const id = String(item.payload.shapeId ?? "");
      let snapshot: Record<string, unknown> | null = null;
      for (const page of boardRef.current.pages) {
        const shape = page.shapes.find((s) => s.id === id);
        if (shape) {
          snapshot = { ...shape, shapeId: shape.id };
          page.shapes = page.shapes.filter((s) => s.id !== id);
        }
      }
      if (snapshot) redoStackRef.current.push({ kind: "shape", payload: snapshot });
      emitEvent("shape_delete", { shapeId: id });
    }
    setHistoryTick((n) => n + 1);
    redraw();
  };

  const redo = () => {
    const item = redoStackRef.current.pop();
    if (!item) return;
    if (item.kind === "stroke") {
      const p = item.payload;
      const page =
        boardRef.current.pages.find((pg) => pg.id === p.pageId) ?? boardRef.current.currentPage;
      if (page) {
        page.strokes.push({
          id: String(p.strokeId),
          pageId: String(p.pageId),
          tool: String(p.tool ?? tool) as WhiteboardTool,
          color: String(p.color ?? color),
          opacity: typeof p.opacity === "number" ? p.opacity : 1,
          width: typeof p.width === "number" ? p.width : 3.5,
          points: Array.isArray(p.points) ? (p.points as { x: number; y: number; p?: number }[]) : [],
        });
      }
      emitEvent("stroke_begin", {
        strokeId: p.strokeId,
        pageId: p.pageId,
        tool: p.tool,
        color: p.color,
        opacity: p.opacity,
        width: p.width,
      });
      emitEvent("stroke_end", { strokeId: p.strokeId, pageId: p.pageId, points: p.points });
      undoStackRef.current.push({
        kind: "stroke",
        payload: { strokeId: p.strokeId, pageId: p.pageId },
      });
    } else if (item.kind === "shape") {
      const p = item.payload;
      const t = recording ? engineRef.current.now() : playheadMs;
      boardRef.current.apply({ id: String(p.shapeId), t, type: "shape_add", payload: p });
      emitEvent("shape_add", p);
      undoStackRef.current.push({
        kind: "shape",
        payload: { shapeId: p.shapeId, pageId: p.pageId },
      });
    }
    setHistoryTick((n) => n + 1);
    redraw();
  };

  const addPage = () => {
    const id = `page_${uid()}`;
    boardRef.current.addBlankPage(id);
    setPageIds(boardRef.current.pages.map((p) => p.id));
    setCurrentPageId(id);
    if (recording || editMode) {
      emitEvent("page_add", { pageId: id, index: boardRef.current.pages.length - 1, kind: "blank" });
      emitEvent("page_select", { pageId: id });
    }
    redraw();
  };

  const selectPage = (id: string) => {
    boardRef.current.currentPageId = id;
    setCurrentPageId(id);
    if (recording || editMode) emitEvent("page_select", { pageId: id });
    redraw();
  };

  const clearPage = () => {
    if (recording || editMode) emitEvent("page_clear", { pageId: currentPageId });
    boardRef.current.apply({
      id: uid(),
      t: recording ? engineRef.current.now() : playheadMs,
      type: "page_clear",
      payload: { pageId: currentPageId },
    });
    redraw();
  };

  const toggleTheme = () => {
    const next = nextWhiteboardTheme(theme);
    setTheme(next);
    boardRef.current.theme = next;
    const ink = boardThemeColors(next).defaultInk;
    setColor(ink);
    if (recording || editMode) {
      emitEvent("theme_change", { theme: next });
      emitEvent("color_change", { color: ink });
    }
    redraw();
  };

  const togglePreview = async () => {
    if (!audioBlobRef.current) return;
    let audio = audioPreviewRef.current;
    if (!audio) {
      audio = new Audio();
      audioPreviewRef.current = audio;
    }
    if (previewPlaying) {
      audio.pause();
      setPreviewPlaying(false);
      return;
    }
    const url = URL.createObjectURL(audioBlobRef.current);
    audio.src = url;
    audio.currentTime = playheadMs / 1000;
    await audio.play();
    setPreviewPlaying(true);
  };

  const elapsedLabel = useMemo(() => fmtMs(elapsed), [elapsed]);
  const maxDur = Math.max(1, durationMs || previousDurationRef.current || 1);

  if (loadingEdit) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-card-border text-sm text-muted">
        Loading whiteboard for edit…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-card-border text-sm text-red-600">
        <p>{loadError}</p>
        {onCancel && (
          <button type="button" className="text-xs underline" onClick={onCancel}>
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex h-[min(80vh,800px)] flex-col overflow-hidden rounded-xl border border-card-border"
      style={{ background: chromeBg, color: chromeFg }}
    >
      <div
        className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: theme === "BLACK" ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.12)" }}
      >
        <input
          className="min-w-[160px] flex-1 bg-transparent text-sm font-semibold outline-none placeholder:opacity-45"
          style={{ color: chromeFg, caretColor: chromeFg }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lesson title"
        />
        {editMode && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
            Editing
          </span>
        )}
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-xs"
          style={{ color: chromeFg }}
          onClick={toggleTheme}
        >
          Theme: {boardThemeColors(theme).label}
        </button>
        {!recording ? (
          <>
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white"
              onClick={startRecording}
            >
              {editMode ? "Continue recording" : "Start Recording"}
            </button>
            {editMode && (
              <button
                type="button"
                disabled={saving || dirtyRanges.length === 0}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                onClick={() => void stopAndPublish()}
              >
                {saving ? "Publishing…" : "Publish edit"}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            disabled={saving}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            onClick={() => void stopAndPublish()}
          >
            {saving ? "Saving…" : `Stop & Publish (${elapsedLabel})`}
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs"
            style={{ color: chromeFg }}
            onClick={onCancel}
          >
            Close
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-black/10 px-2 py-2">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTool(t.id);
              boardRef.current.tool = t.id;
              if (recording || editMode) emitEvent("tool_change", { tool: t.id });
            }}
            className={`rounded-md px-2 py-1 text-[11px] ${tool === t.id ? "bg-blue-600 text-white" : "bg-black/10"}`}
          >
            {t.label}
          </button>
        ))}
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => {
              setColor(c);
              if (recording || editMode) emitEvent("color_change", { color: c });
            }}
            className="h-6 w-6 rounded-full border-2"
            style={{ background: c, borderColor: color === c ? "#2563EB" : "transparent" }}
          />
        ))}
        {STROKE_WIDTH_PRESETS.map((w) => (
          <button
            key={w}
            type="button"
            title={`Thickness ${w}`}
            onClick={() => setStrokeWidth(w)}
            className={`flex h-7 w-7 items-center justify-center rounded-md ${
              Math.abs(strokeWidth - w) < 0.01 ? "bg-blue-600" : "bg-black/10"
            }`}
          >
            <span
              className="rounded-full"
              style={{
                width: Math.min(18, 4 + w),
                height: Math.min(18, 4 + w),
                background: Math.abs(strokeWidth - w) < 0.01 ? "#fff" : chromeFg,
              }}
            />
          </button>
        ))}
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={undo} disabled={undoStackRef.current.length === 0}>
          Undo
        </button>
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={redo} disabled={redoStackRef.current.length === 0}>
          Redo
        </button>
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={clearPage}>
          Clear page
        </button>
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={() => void attachCoursePdf()}>
          Course PDF
        </button>
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={() => void importDevicePdf()}>
          Import PDF
        </button>
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={() => nudgeViewZoom(1 / 1.35)}>
          Board −
        </button>
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={() => nudgeViewZoom(1.35)}>
          Board +
        </button>
        {viewZoom > 1.05 && (
          <button
            type="button"
            className="rounded-md bg-black/10 px-2 py-1 text-[11px]"
            onClick={() => {
              discardInProgressInk();
              setViewZoom(1);
            }}
          >
            {viewZoom.toFixed(1)}× Reset
          </button>
        )}
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={() => nudgePdfZoom(1 / 1.25)}>
          PDF −
        </button>
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={() => nudgePdfZoom(1.25)}>
          PDF +
        </button>
        {/* keep historyTick referenced so undo/redo buttons re-enable */}
        <span className="sr-only">{historyTick}</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onWheel={onWheel}
        />
      </div>

      {editMode && (
        <div className="space-y-2 border-t border-black/10 px-3 py-2">
          <div className="relative h-8 rounded-md bg-black/10">
            {dirtyRanges.map((r) => (
              <div
                key={r.id}
                className="absolute top-0 h-full bg-amber-400/50"
                style={{
                  left: `${(r.startMs / maxDur) * 100}%`,
                  width: `${(Math.max(8, r.endMs - r.startMs) / maxDur) * 100}%`,
                }}
                title={`${r.kind} ${fmtMs(r.startMs)}–${fmtMs(r.endMs)}`}
              />
            ))}
            <input
              type="range"
              className="absolute inset-0 w-full opacity-80"
              min={0}
              max={maxDur}
              value={playheadMs}
              onChange={(e) => seekPreview(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <button type="button" className="rounded-md bg-black/10 px-2 py-1" onClick={() => void togglePreview()}>
              {previewPlaying ? "Pause" : "Play"}
            </button>
            <span>
              {fmtMs(playheadMs)} / {fmtMs(durationMs)}
            </span>
            <button type="button" className="rounded-md bg-black/10 px-2 py-1" onClick={() => setTrimIn(playheadMs)}>
              Set In {trimIn != null ? `(${fmtMs(trimIn)})` : ""}
            </button>
            <button type="button" className="rounded-md bg-black/10 px-2 py-1" onClick={() => setTrimOut(playheadMs)}>
              Set Out {trimOut != null ? `(${fmtMs(trimOut)})` : ""}
            </button>
            <button
              type="button"
              className="rounded-md bg-red-600/90 px-2 py-1 text-white disabled:opacity-40"
              disabled={trimIn == null || trimOut == null}
              onClick={() => void cutSelection()}
            >
              Cut selection
            </button>
            {dirtyRanges.length > 0 && (
              <span className="opacity-80">
                {dirtyRanges.length} edited segment{dirtyRanges.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-black/10 px-2 py-2">
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-xs" onClick={addPage}>
          + Page
        </button>
        <div className="flex gap-1 overflow-x-auto">
          {pageIds.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => selectPage(id)}
              className={`rounded-md px-2 py-1 text-xs ${currentPageId === id ? "bg-blue-600 text-white" : "bg-black/10"}`}
            >
              P{i + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
