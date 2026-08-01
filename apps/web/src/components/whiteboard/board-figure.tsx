"use client";

import { useEffect, useRef } from "react";

/** Sanitized ubrd-figure spec produced by the AI chat (see services/ai/board-figures). */
export type BoardFigureSpec = {
  schemaVersion?: number;
  format?: string;
  title?: string;
  boardWidth?: number;
  boardHeight?: number;
  shapes?: Array<{
    kind: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    width: number;
  }>;
  texts?: Array<{
    x: number;
    y: number;
    text: string;
    color: string;
    fontSize: number;
  }>;
  strokes?: Array<{
    color: string;
    opacity?: number;
    width: number;
    points: Array<{ x: number; y: number }>;
  }>;
};

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color: string
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.max(width * 3.2, 14);
  const px = -uy;
  const py = ux;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * head + px * head * 0.45, y2 - uy * head + py * head * 0.45);
  ctx.lineTo(x2 - ux * head - px * head * 0.45, y2 - uy * head - py * head * 0.45);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function paintFigure(
  ctx: CanvasRenderingContext2D,
  spec: BoardFigureSpec,
  w: number,
  h: number
) {
  const boardW = spec.boardWidth || 1920;
  const boardH = spec.boardHeight || 1080;
  const s = Math.min(w / boardW, h / boardH);
  const ox = (w - boardW * s) / 2;
  const oy = (h - boardH * s) / 2;

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.translate(ox, oy);
  ctx.scale(s, s);

  // Board surface — white with a faint dot grid like the studio board.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, boardW, boardH);
  ctx.fillStyle = "rgba(17, 24, 39, 0.05)";
  for (let gx = 60; gx < boardW; gx += 60) {
    for (let gy = 60; gy < boardH; gy += 60) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const shape of spec.shapes || []) {
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.width;
    const x = Math.min(shape.x1, shape.x2);
    const y = Math.min(shape.y1, shape.y2);
    const sw = Math.abs(shape.x2 - shape.x1);
    const sh = Math.abs(shape.y2 - shape.y1);
    switch (shape.kind) {
      case "circle":
        ctx.beginPath();
        ctx.ellipse(x + sw / 2, y + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "line":
        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        ctx.stroke();
        break;
      case "arrow":
        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        ctx.stroke();
        drawArrowHead(ctx, shape.x1, shape.y1, shape.x2, shape.y2, shape.width, shape.color);
        break;
      default:
        ctx.strokeRect(x, y, sw, sh);
    }
  }

  for (const stroke of spec.strokes || []) {
    const pts = stroke.points || [];
    if (pts.length < 2) continue;
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    if (pts.length === 2) {
      ctx.lineTo(pts[1]!.x, pts[1]!.y);
    } else {
      // Quadratic midpoints — same smoothing as the whiteboard player.
      for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i]!.x + pts[i + 1]!.x) / 2;
        const midY = (pts[i]!.y + pts[i + 1]!.y) / 2;
        ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, midX, midY);
      }
      ctx.lineTo(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const text of spec.texts || []) {
    ctx.fillStyle = text.color;
    ctx.font = `600 ${text.fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(text.text, text.x, text.y);
  }

  ctx.restore();
}

/** Renders an AI-drawn whiteboard figure inside the chat thread. */
export function BoardFigure({ spec }: { spec: BoardFigureSpec }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round((w * (spec.boardHeight || 1080)) / (spec.boardWidth || 1920)));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintFigure(ctx, spec, w, h);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [spec]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <canvas ref={canvasRef} className="block w-full" />
      {spec.title ? (
        <p className="border-t border-border px-3 py-2 text-xs text-muted">
          {spec.title}
        </p>
      ) : null}
    </div>
  );
}
