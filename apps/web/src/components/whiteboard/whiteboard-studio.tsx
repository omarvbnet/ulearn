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
import { buildUbrdPackage } from "@/lib/whiteboard/package";
import {
  LOGICAL_BOARD_HEIGHT,
  LOGICAL_BOARD_WIDTH,
  type WhiteboardThemeId,
  type WhiteboardTool,
} from "@/lib/whiteboard/types";
import { defaultOpacityForTool, defaultWidthForTool, smoothStrokePoints } from "@/lib/whiteboard/smoothing";

type Props = {
  courseId: string;
  initialTitle?: string;
  onPublished?: () => void;
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

export default function WhiteboardStudio({ courseId, initialTitle, onPublished, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(new EventEngine());
  const boardRef = useRef(new BoardState());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const activeStrokeRef = useRef<{ id: string; points: { x: number; y: number; p?: number }[] } | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const draftTimer = useRef<number | null>(null);
  const pdfsRef = useRef<
    { assetId: string; materialId?: string; fileKey?: string; fileUrl?: string; title: string }[]
  >([]);

  const [title, setTitle] = useState(initialTitle || "Whiteboard lesson");
  const [theme, setTheme] = useState<WhiteboardThemeId>("WHITE");
  const [tool, setTool] = useState<WhiteboardTool>("pen");
  const [color, setColor] = useState("#111827");
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pageIds, setPageIds] = useState<string[]>(["page_0"]);
  const [currentPageId, setCurrentPageId] = useState("page_0");
  const [, bump] = useState(0);
  const redraw = useCallback(() => bump((n) => n + 1), []);

  const boardBg = theme === "BLACK" ? "#0B0F14" : "#F8FAFC";
  const chromeBg = theme === "BLACK" ? "#111827" : "#EEF2F7";
  const chromeFg = theme === "BLACK" ? "#F8FAFC" : "#0F172A";

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const scale = Math.min(rect.width / LOGICAL_BOARD_WIDTH, rect.height / LOGICAL_BOARD_HEIGHT);
    const dx = (rect.width - LOGICAL_BOARD_WIDTH * scale) / 2;
    const dy = (rect.height - LOGICAL_BOARD_HEIGHT * scale) / 2;
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = chromeBg;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.scale(scale, scale);
    ctx.fillStyle = boardBg;
    ctx.fillRect(0, 0, LOGICAL_BOARD_WIDTH, LOGICAL_BOARD_HEIGHT);

    const board = boardRef.current;
    const page = board.currentPage;
    if (!page) {
      ctx.restore();
      return;
    }

    for (const shape of page.shapes) {
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.beginPath();
      if (shape.kind === "circle") {
        const cx = (shape.x1 + shape.x2) / 2;
        const cy = (shape.y1 + shape.y2) / 2;
        const rx = Math.abs(shape.x2 - shape.x1) / 2;
        const ry = Math.abs(shape.y2 - shape.y1) / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
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
    ctx.restore();
  }, [boardBg, chromeBg]);

  useEffect(() => {
    paint();
  });

  useEffect(() => {
    const onResize = () => paint();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [paint]);

  useEffect(() => {
    draftTimer.current = window.setInterval(() => {
      if (!engineRef.current.isRecording) return;
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
      if (draftTimer.current) window.clearInterval(draftTimer.current);
    };
  }, [courseId, theme, title]);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setElapsed(engineRef.current.now()), 250);
    return () => window.clearInterval(id);
  }, [recording]);

  const toLogical = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / LOGICAL_BOARD_WIDTH, rect.height / LOGICAL_BOARD_HEIGHT);
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
    engine.start();
    engine.push("session_start", {
      theme,
      boardWidth: LOGICAL_BOARD_WIDTH,
      boardHeight: LOGICAL_BOARD_HEIGHT,
    });
    engine.push("page_select", { pageId: currentPageId });
    setRecording(true);
    setElapsed(0);
  };

  const stopAndPublish = async () => {
    if (!recording || saving) return;
    setSaving(true);
    try {
      const recorder = mediaRecorderRef.current;
      const audioBlob = await new Promise<Blob>((resolve, reject) => {
        if (!recorder) return reject(new Error("NO_RECORDER"));
        recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
        recorder.stop();
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const durationMs = engineRef.current.stop();
      const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
      const packageBytes = await buildUbrdPackage({
        engine: engineRef.current,
        audioBytes,
        audioFileName: "audio.webm",
        audioCodec: "opus",
        theme,
        pageCount: boardRef.current.pages.length,
        durationMs,
        assets: { pdfs: pdfsRef.current },
      });

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
          durationSec: Math.ceil(durationMs / 1000),
          theme,
          schemaVersion: 1,
        }),
      });
      if (!complete.ok) throw new Error("COMPLETE_FAILED");

      const lesson = await fetch(`/api/teacher/courses/${courseId}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Whiteboard lesson",
          lessonType: "WHITEBOARD",
          whiteboardAssetId: upload.whiteboardId,
          durationSec: Math.ceil(durationMs / 1000),
          fileKey: upload.objectKey,
        }),
      });
      if (!lesson.ok) throw new Error("LESSON_CREATE_FAILED");

      localStorage.removeItem(`wb_draft_${courseId}`);
      onPublished?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setRecording(false);
      setSaving(false);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const pt = toLogical(e);
    const pageId = boardRef.current.currentPageId ?? "page_0";
    const engine = engineRef.current;

    if (tool === "laser") {
      boardRef.current.laser = { pageId, x: pt.x, y: pt.y, visible: true };
      if (recording) engine.push("laser_move", { pageId, x: pt.x, y: pt.y, visible: true });
      redraw();
      return;
    }
    if (tool === "text") {
      const text = window.prompt("Text");
      if (!text?.trim()) return;
      const textId = uid();
      const payload = { textId, pageId, x: pt.x, y: pt.y, text: text.trim(), color, fontSize: 28 };
      boardRef.current.apply({ id: textId, t: engine.now(), type: "text_insert", payload });
      if (recording) engine.push("text_insert", payload);
      redraw();
      return;
    }
    if (tool === "rect" || tool === "circle" || tool === "line" || tool === "arrow") {
      shapeStartRef.current = { x: pt.x, y: pt.y, id: uid() };
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
      if (recording) engine.push("erase", { pageId, strokeIds: hit });
      redraw();
      return;
    }

    const strokeId = uid();
    activeStrokeRef.current = { id: strokeId, points: [{ x: pt.x, y: pt.y, p: pt.p }] };
    if (recording) {
      engine.push("stroke_begin", {
        strokeId,
        pageId,
        tool,
        color,
        opacity: defaultOpacityForTool(tool),
        width: defaultWidthForTool(tool),
      });
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pt = toLogical(e);
    const pageId = boardRef.current.currentPageId ?? "page_0";
    if (tool === "laser") {
      boardRef.current.laser = { pageId, x: pt.x, y: pt.y, visible: true };
      if (recording) engineRef.current.push("laser_move", { pageId, x: pt.x, y: pt.y, visible: true });
      redraw();
      return;
    }
    const active = activeStrokeRef.current;
    if (!active) return;
    active.points.push({ x: pt.x, y: pt.y, p: pt.p });
    if (recording) engineRef.current.push("stroke_point", { strokeId: active.id, x: pt.x, y: pt.y, p: pt.p });
    // Live preview: temporary stroke on board
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
          width: defaultWidthForTool(tool),
          points: active.points.map((p) => ({ ...p })),
        });
      }
    }
    redraw();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pt = toLogical(e);
    const pageId = boardRef.current.currentPageId ?? "page_0";
    const engine = engineRef.current;

    if (shapeStartRef.current) {
      const start = shapeStartRef.current;
      const payload = {
        shapeId: start.id,
        pageId,
        kind: tool,
        x1: start.x,
        y1: start.y,
        x2: pt.x,
        y2: pt.y,
        color,
        width: 2.5,
      };
      boardRef.current.apply({ id: start.id, t: engine.now(), type: "shape_add", payload });
      if (recording) engine.push("shape_add", payload);
      shapeStartRef.current = null;
      redraw();
      return;
    }

    const active = activeStrokeRef.current;
    if (!active) return;
    const points = smoothStrokePoints(active.points);
    const page = boardRef.current.currentPage;
    if (page) {
      const idx = page.strokes.findIndex((s) => s.id === active.id);
      const stroke = {
        id: active.id,
        pageId,
        tool,
        color,
        opacity: defaultOpacityForTool(tool),
        width: defaultWidthForTool(tool),
        points,
      };
      if (idx >= 0) page.strokes[idx] = stroke;
      else page.strokes.push(stroke);
    }
    if (recording) {
      engine.push("stroke_end", {
        strokeId: active.id,
        pageId,
        points,
      });
    }
    activeStrokeRef.current = null;
    redraw();
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
      if (recording) {
        engineRef.current.push("pdf_open", { assetId, title: chosen.title });
        engineRef.current.push("page_add", {
          pageId,
          index: boardRef.current.pages.length - 1,
          kind: "pdf",
          pdfAssetId: assetId,
          pdfPage: 1,
        });
        engineRef.current.push("page_select", { pageId });
      }
      redraw();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not attach PDF");
    }
  };

  const addPage = () => {
    const id = `page_${uid()}`;
    boardRef.current.addBlankPage(id);
    setPageIds(boardRef.current.pages.map((p) => p.id));
    setCurrentPageId(id);
    if (recording) {
      engineRef.current.push("page_add", { pageId: id, index: boardRef.current.pages.length - 1, kind: "blank" });
      engineRef.current.push("page_select", { pageId: id });
    }
    redraw();
  };

  const selectPage = (id: string) => {
    boardRef.current.currentPageId = id;
    setCurrentPageId(id);
    if (recording) engineRef.current.push("page_select", { pageId: id });
    redraw();
  };

  const clearPage = () => {
    if (recording) engineRef.current.push("page_clear", { pageId: currentPageId });
    boardRef.current.apply({
      id: uid(),
      t: engineRef.current.now(),
      type: "page_clear",
      payload: { pageId: currentPageId },
    });
    redraw();
  };

  const toggleTheme = () => {
    const next: WhiteboardThemeId = theme === "WHITE" ? "BLACK" : "WHITE";
    setTheme(next);
    boardRef.current.theme = next;
    setColor(next === "BLACK" ? "#F8FAFC" : "#111827");
    if (recording) {
      engineRef.current.push("theme_change", { theme: next });
      engineRef.current.push("color_change", { color: next === "BLACK" ? "#F8FAFC" : "#111827" });
    }
    redraw();
  };

  const elapsedLabel = useMemo(() => {
    const s = Math.floor(elapsed / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, [elapsed]);

  return (
    <div className="flex h-[min(80vh,800px)] flex-col overflow-hidden rounded-xl border border-card-border" style={{ background: chromeBg, color: chromeFg }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-black/10 px-3 py-2">
        <input
          className="min-w-[160px] flex-1 bg-transparent text-sm font-semibold outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lesson title"
        />
        <button type="button" className="rounded-lg px-2 py-1 text-xs hover:bg-black/10" onClick={toggleTheme}>
          Theme: {theme}
        </button>
        {!recording ? (
          <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white" onClick={startRecording}>
            Start Recording
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            onClick={stopAndPublish}
          >
            {saving ? "Saving…" : `Stop & Publish (${elapsedLabel})`}
          </button>
        )}
        {onCancel && (
          <button type="button" className="rounded-lg px-2 py-1 text-xs hover:bg-black/10" onClick={onCancel}>
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
              if (recording) engineRef.current.push("tool_change", { tool: t.id });
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
              if (recording) engineRef.current.push("color_change", { color: c });
            }}
            className="h-6 w-6 rounded-full border-2"
            style={{ background: c, borderColor: color === c ? "#2563EB" : "transparent" }}
          />
        ))}
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={clearPage}>
          Clear page
        </button>
        <button type="button" className="rounded-md bg-black/10 px-2 py-1 text-[11px]" onClick={attachCoursePdf}>
          Open course PDF
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </div>

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
