"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  bridgeKindToEmotion,
  classroomBridgePhrase,
  type ClassroomBridgeKind,
} from "@/services/ai/voice-accent";

type BoardAction = {
  time?: number;
  action: string;
  parameters?: Record<string, unknown>;
};

type ClassroomBeat = {
  speak: string[];
  board: BoardAction[];
  askStudent?: string | null;
  waitForStudentMs?: number;
  emotion?: string;
  pace?: "slow" | "normal" | "brisk";
  lessonName?: string | null;
  answerCorrect?: boolean | null;
  sessionComplete?: boolean;
};

type ClassroomSession = {
  id: string;
  status: string;
  locale: string;
  countryCode: string | null;
  provinceName?: string | null;
  speechLocale: string;
  accent: string;
  materialNames: string[];
  curriculumOutline: string[];
  beatIndex: number;
  state?: {
    currentLessonName?: string | null;
    emotionalState?: string;
    lastAskStudent?: string | null;
  };
};

type Presence = "thinking" | "speaking" | "listening" | "waiting" | "idle";

const BOARD_W = 1920;
const BOARD_H = 1080;

type BoardItem =
  | {
      kind: "text";
      id: string;
      text: string;
      x: number;
      y: number;
      color: string;
      size: number;
      bornAt: number;
      writeMs: number;
      align: "left" | "right";
      seed: number;
    }
  | {
      kind: "line" | "arrow" | "circle" | "rect" | "highlight";
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
      bornAt: number;
      writeMs: number;
      seed: number;
    }
  | {
      /** Emphasis ellipse drawn around a word/phrase already on the board. */
      kind: "circleHighlight";
      id: string;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      color: string;
      width: number;
      bornAt: number;
      writeMs: number;
      seed: number;
    }
  | {
      /** Brief pointer indicator near existing content — fades on its own,
       *  never leaves permanent ink. */
      kind: "pointer";
      id: string;
      x: number;
      y: number;
      color: string;
      bornAt: number;
      writeMs: number;
      holdMs: number;
      fadeMs: number;
      seed: number;
    };

function num(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function resolveColor(raw: unknown, fallback = "#1e3a8a") {
  const c = String(raw ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    blue: "#1d4ed8",
    red: "#dc2626",
    green: "#059669",
    orange: "#ea580c",
    black: "#0f172a",
    yellow: "#ca8a04",
    purple: "#7c3aed",
    brown: "#92400e",
  };
  if (map[c]) return map[c];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return c;
  return fallback;
}

function cleanText(raw: unknown): string {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s) return "";
  if (/language|lesson_title|objective|parameters|action\s*:/i.test(s)) return "";
  return s.replace(/\s+/g, " ").slice(0, 90);
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 2.4);
}

function jitter(seed: number, i: number, amp = 4.5) {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 * amp - amp;
}

function applyActions(
  items: BoardItem[],
  actions: BoardAction[],
  rtl: boolean,
  cursorY: number,
  diagramCursorY: number
): { items: BoardItem[]; cursorY: number; diagramCursorY: number } {
  let acc = [...items];
  let yCursor = cursorY || 160;
  let diagramY = diagramCursorY || 220;
  // Consecutive counting-style shapes (circles/rectangles) inside the SAME
  // beat lay out left-to-right in one row — e.g. "3 apples" reads as three
  // circles side by side, not stacked in a totem pole — instead of each
  // shape claiming its own vertical slot.
  let shapeSlot = 0;
  let penAt = nowMs();
  const textX = rtl ? 1720 : 120;
  const diagramX = rtl ? 380 : 1320;

  actions.forEach((cue, idx) => {
    const action = String(cue.action || "").toLowerCase().replace(/\s+/g, "_");
    const p = cue.parameters || {};
    const id = `${Date.now()}-${idx}-${action}`;
    const seed = idx * 97 + Math.floor(num(cue.time, idx) * 3);
    if (action === "clear_board" || action === "open_new_board") {
      acc = [];
      yCursor = 160;
      diagramY = 220;
      shapeSlot = 0;
      penAt = nowMs();
      return;
    }
    if (
      action === "write_text" ||
      action === "draw_formula" ||
      action === "draw_equation"
    ) {
      const text = cleanText(p.text ?? p.content ?? p.latex).slice(0, 26);
      if (!text) return;
      if (yCursor > 900) {
        acc = [];
        yCursor = 160;
      }
      const size = Math.max(
        48,
        Math.min(64, num(p.size, text.length < 12 ? 60 : 52))
      );
      const writeMs = Math.max(900, Math.min(4200, text.length * 70));
      acc.push({
        kind: "text",
        id,
        text,
        x: textX + jitter(seed, 1, 1.5),
        y: yCursor + jitter(seed, 2, 1.2),
        color: resolveColor(p.color),
        size,
        bornAt: penAt,
        writeMs,
        align: rtl ? "right" : "left",
        seed,
      });
      yCursor += Math.max(120, size + 68);
      penAt += writeMs + 160;
      return;
    }
    if (
      action === "highlight" ||
      action === "underline" ||
      action === "draw_line"
    ) {
      const uy = Math.max(150, yCursor - 72);
      acc.push({
        kind: "line",
        id,
        x1: textX,
        y1: uy,
        x2: textX + (rtl ? -520 : 520),
        y2: uy,
        color: resolveColor(p.color, "#ea580c"),
        width: 4.2,
        bornAt: penAt,
        writeMs: 700,
        seed,
      });
      penAt += 740;
      return;
    }
    if (action === "circle_highlight" || action === "circle_text") {
      // Circle a word/phrase already on the board — find the last text item
      // and wrap an ellipse around its actual bounds, instead of drawing a
      // brand-new diagram shape (that's draw_circle's job).
      const target = [...acc].reverse().find(
        (it): it is Extract<BoardItem, { kind: "text" }> => it.kind === "text"
      );
      if (target) {
        const approxW = Math.max(90, target.text.length * target.size * 0.52);
        const cx = target.align === "right" ? target.x - approxW / 2 : target.x + approxW / 2;
        const cy = target.y - target.size * 0.38;
        acc.push({
          kind: "circleHighlight",
          id,
          cx,
          cy,
          rx: approxW / 2 + 26,
          ry: target.size * 0.75,
          color: resolveColor(p.color, "#dc2626"),
          width: 3.4,
          bornAt: penAt,
          writeMs: 700,
          seed,
        });
        penAt += 740;
      }
      return;
    }
    if (action === "point_at" || action === "point") {
      // A brief pointer near existing content — never adds permanent ink.
      const target = [...acc].reverse().find(
        (it): it is Extract<BoardItem, { kind: "text" }> => it.kind === "text"
      );
      const px = target
        ? target.align === "right"
          ? target.x - 16
          : target.x + 16
        : diagramX;
      const py = target ? target.y - target.size * 0.7 : diagramY;
      acc.push({
        kind: "pointer",
        id,
        x: px,
        y: py,
        color: resolveColor(p.color, "#2563eb"),
        bornAt: penAt,
        writeMs: 260,
        holdMs: 1200,
        fadeMs: 650,
        seed,
      });
      penAt += 300;
      return;
    }
    if (action === "draw_arrow") {
      const ay = Math.min(860, diagramY);
      acc.push({
        kind: "arrow",
        id,
        x1: diagramX - 40,
        y1: ay + 70,
        x2: diagramX + 140,
        y2: ay,
        color: resolveColor(p.color, "#059669"),
        width: 3.2,
        bornAt: penAt,
        writeMs: 1000,
        seed,
      });
      penAt += 1050;
      diagramY += 140;
      shapeSlot = 0;
    } else if (action === "draw_circle" || action === "circle") {
      const r = Math.max(32, Math.min(48, num(p.r, 42)));
      const slotGap = r * 2 + 34;
      const rowMax = 3;
      if (shapeSlot >= rowMax) {
        diagramY += r * 2 + 46;
        shapeSlot = 0;
      }
      const cx = diagramX + 40 + shapeSlot * (rtl ? -slotGap : slotGap);
      const cy = Math.min(860, diagramY + r);
      acc.push({
        kind: "circle",
        id,
        x1: cx - r,
        y1: cy - r,
        x2: cx + r,
        y2: cy + r,
        color: resolveColor(p.color, "#dc2626"),
        width: 3,
        bornAt: penAt,
        writeMs: 900,
        seed,
      });
      penAt += 750;
      shapeSlot += 1;
    } else if (action === "draw_rectangle" || action === "draw_rect") {
      const w = 130;
      const h = 84;
      const slotGap = w + 36;
      const rowMax = 3;
      if (shapeSlot >= rowMax) {
        diagramY += h + 46;
        shapeSlot = 0;
      }
      const rx = diagramX - w / 2 + shapeSlot * (rtl ? -slotGap : slotGap);
      const ry = Math.min(860, diagramY);
      acc.push({
        kind: "rect",
        id,
        x1: rx,
        y1: ry,
        x2: rx + w,
        y2: ry + h,
        color: resolveColor(p.color, "#92400e"),
        width: 3,
        bornAt: penAt,
        writeMs: 850,
        seed,
      });
      penAt += 750;
      shapeSlot += 1;
    }
  });
  // Leave room below whatever this beat drew so the next beat's diagram
  // never overlaps it — mirrors how the text column advances via yCursor.
  if (shapeSlot > 0) diagramY += 60;
  return { items: acc, cursorY: yCursor, diagramCursorY: Math.min(diagramY, 780) };
}

function progressOf(item: BoardItem, clock: number) {
  return easeOut(Math.max(0, Math.min(1, (clock - item.bornAt) / item.writeMs)));
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "audio/mpeg" });
}

/**
 * A stalled request (weak connection, backend hiccup) with no timeout used
 * to freeze the whole classroom forever — nothing ever rejected, so the
 * loop just waited on a promise that never settled. Every classroom fetch
 * must have a hard ceiling so failures can be retried/surfaced instead.
 */
function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/** Classroom session/beat/turn calls generate a fresh lesson beat with the
 * LLM and can legitimately take longer than a plain CRUD request — the
 * default 30s ceiling was surfacing "Request timed out" mid-lesson. */
const LLM_TIMEOUT_MS = 55000;

function isTransientFetchError(e: unknown): boolean {
  return (e instanceof DOMException && e.name === "AbortError") || e instanceof TypeError;
}

/** POST + JSON parse with one automatic retry (short backoff) on a transient
 * failure — a single dropped socket or slow LLM response must not strand
 * the student on a dead-end error when a second attempt would likely succeed. */
async function postJsonWithRetry(
  input: string,
  body: unknown,
  timeoutMs = LLM_TIMEOUT_MS,
  maxAttempts = 2
): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(
        input,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        timeoutMs
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    } catch (e) {
      lastError = e;
      if (!isTransientFetchError(e) || attempt === maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

let activeCloudAudio: HTMLAudioElement | null = null;

/** Fetches synthesized speech for one line and returns a playable blob URL
 * WITHOUT playing it — this is the piece that lets the caller start
 * fetching line N+1's audio while line N is still speaking, so there is no
 * "fetch gap" of dead air between spoken sentences (VOICE PIPELINE: speech
 * generation should feel like a continuous stream, not fetch→play→fetch→play). */
async function fetchTtsAudioUrl(
  text: string,
  language: string,
  pace: string,
  country?: string | null,
  emotion?: string | null,
  province?: string | null
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout("/api/ai/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language,
        pace,
        ...(country ? { country } : {}),
        ...(emotion ? { emotion } : {}),
        // Passing province (resolved once at session start) lets the TTS
        // route skip its per-call profile DB lookup — see route comment.
        ...(province ? { province } : {}),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data.dataBase64 || data.data?.dataBase64;
    const mime = data.mimeType || data.data?.mimeType || "audio/mpeg";
    if (!b64) return null;
    return URL.createObjectURL(base64ToBlob(b64, mime));
  } catch {
    return null;
  }
}

/** Plays an already-fetched blob URL and resolves once playback ends. */
function playAudioUrl(url: string): Promise<void> {
  if (activeCloudAudio) {
    try {
      activeCloudAudio.pause();
    } catch {
      /* ignore */
    }
    activeCloudAudio = null;
  }
  return new Promise<void>((resolve) => {
    const audio = new Audio(url);
    activeCloudAudio = audio;
    const done = () => {
      URL.revokeObjectURL(url);
      if (activeCloudAudio === audio) activeCloudAudio = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    void audio.play().catch(done);
  });
}

async function speakCloud(
  text: string,
  language: string,
  pace: string,
  country?: string | null,
  emotion?: string | null,
  province?: string | null
): Promise<boolean> {
  const url = await fetchTtsAudioUrl(text, language, pace, country, emotion, province);
  if (url) {
    await playAudioUrl(url);
    return true;
  }
  // One retry — a single failed TTS request must not silence the teacher.
  await new Promise((r) => setTimeout(r, 450));
  const retryUrl = await fetchTtsAudioUrl(text, language, pace, country, emotion, province);
  if (!retryUrl) return false;
  await playAudioUrl(retryUrl);
  return true;
}

function stopCloudAudio() {
  if (!activeCloudAudio) return;
  try {
    activeCloudAudio.pause();
  } catch {
    /* ignore */
  }
  activeCloudAudio = null;
}

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
  confidence?: number;
};
type SpeechRecognitionResultLike = SpeechRecognitionAlternativeLike & {
  isFinal?: boolean;
  length?: number;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  onresult: ((ev: {
    results: ArrayLike<SpeechRecognitionResultLike>;
  }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev?: { error?: string }) => void) | null;
};

/** Pick the highest-confidence alternative the engine offered for a result. */
function bestTranscript(row: SpeechRecognitionResultLike | undefined): string {
  if (!row) return "";
  const count = typeof row.length === "number" ? row.length : 1;
  let best = row[0]?.transcript || "";
  let bestConf = row[0]?.confidence ?? -1;
  for (let j = 1; j < count; j++) {
    const alt = row[j];
    if (alt?.transcript && (alt.confidence ?? -1) > bestConf) {
      bestConf = alt.confidence ?? -1;
      best = alt.transcript;
    }
  }
  return best;
}

/** Fatal permission/setup errors — retrying will only spam the mic prompt. */
const FATAL_SPEECH_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window &
    typeof globalThis & {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      SpeechRecognition?: new () => SpeechRecognitionLike;
    };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const presenceLabel: Record<string, Record<Presence, string>> = {
  en: {
    thinking: "Thinking…",
    speaking: "Teaching…",
    listening: "Listening to you",
    waiting: "Your turn",
    idle: "Ready",
  },
  ar: {
    thinking: "يفكّر…",
    speaking: "يشرح…",
    listening: "يستمع إليك",
    waiting: "دورك",
    idle: "جاهز",
  },
  tr: {
    thinking: "Düşünüyor…",
    speaking: "Anlatıyor…",
    listening: "Seni dinliyor",
    waiting: "Sıra sende",
    idle: "Hazır",
  },
};

function BoardStroke({
  item,
  clock,
}: {
  item: BoardItem;
  clock: number;
}) {
  if (item.kind === "pointer") {
    const t = clock - item.bornAt;
    let alpha = 0;
    if (t >= 0 && t < item.writeMs) {
      alpha = easeOut(t / item.writeMs);
    } else if (t < item.writeMs + item.holdMs) {
      alpha = 1;
    } else if (t < item.writeMs + item.holdMs + item.fadeMs) {
      alpha = 1 - (t - item.writeMs - item.holdMs) / item.fadeMs;
    }
    if (alpha <= 0.01) return null;
    const pulse = 12 + 6 * Math.min(1, t / item.writeMs);
    return (
      <g key={item.id} opacity={alpha}>
        <circle cx={item.x} cy={item.y} r={pulse + 8} fill={item.color} opacity={0.16} />
        <circle cx={item.x} cy={item.y} r={pulse} fill="none" stroke={item.color} strokeWidth={3} />
        <circle cx={item.x} cy={item.y} r={4} fill={item.color} />
      </g>
    );
  }

  if (item.kind === "circleHighlight") {
    const p = progressOf(item, clock);
    if (p <= 0) return null;
    const jx = jitter(item.seed, 3, 1.6);
    const jy = jitter(item.seed, 4, 1.6);
    return (
      <g key={item.id}>
        <ellipse
          cx={item.cx + jx}
          cy={item.cy + jy}
          rx={item.rx}
          ry={item.ry}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width + 2}
          opacity={0.16 * p}
        />
        <ellipse
          cx={item.cx + jx}
          cy={item.cy + jy}
          rx={item.rx * Math.max(0.3, p)}
          ry={item.ry * Math.max(0.3, p)}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width}
          opacity={0.55 + 0.45 * p}
        />
      </g>
    );
  }

  const p = progressOf(item, clock);
  if (p <= 0) return null;

  if (item.kind === "highlight") {
    const w = (item.x2 - item.x1) * p;
    const h = item.y2 - item.y1;
    return (
      <rect
        key={item.id}
        x={Math.min(item.x1, item.x1 + w)}
        y={item.y1}
        width={Math.abs(w)}
        height={h}
        fill={item.color}
        opacity={0.28 * p}
        rx={8}
      />
    );
  }

  if (item.kind === "text") {
    const chars =
      p >= 0.995
        ? item.text.length
        : Math.max(1, Math.ceil(item.text.length * p));
    const shown = item.text.slice(0, chars);
    const jx = jitter(item.seed, 5, 1.2);
    return (
      <g key={item.id}>
        <text
          x={item.x + jx}
          y={item.y}
          fill={item.color}
          fillOpacity={0.22}
          fontSize={item.size}
          fontFamily="Georgia, 'Times New Roman', 'Noto Naskh Arabic', serif"
          fontWeight={600}
          textAnchor={item.align === "right" ? "end" : "start"}
          transform={`translate(1.4 1.6)`}
        >
          {shown}
        </text>
        <text
          x={item.x + jx}
          y={item.y}
          fill={item.color}
          fillOpacity={0.42 + 0.58 * p}
          fontSize={item.size}
          fontFamily="Georgia, 'Times New Roman', 'Noto Naskh Arabic', serif"
          fontWeight={600}
          textAnchor={item.align === "right" ? "end" : "start"}
        >
          {shown}
        </text>
      </g>
    );
  }

  const x2 = item.x1 + (item.x2 - item.x1) * p;
  const y2 = item.y1 + (item.y2 - item.y1) * p;
  const mx = (item.x1 + x2) / 2 + jitter(item.seed, 1, 12);
  const my = (item.y1 + y2) / 2 + jitter(item.seed, 2, 10);

  if (item.kind === "circle") {
    const cx = (item.x1 + item.x2) / 2 + jitter(item.seed, 3, 1.4);
    const cy = (item.y1 + item.y2) / 2 + jitter(item.seed, 4, 1.4);
    const r = Math.abs(item.x2 - item.x1) / 2;
    const circ = 2 * Math.PI * r;
    return (
      <g key={item.id}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width + 2}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - p)}
          opacity={0.14 * p}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - p)}
          opacity={0.5 + 0.5 * p}
        />
      </g>
    );
  }

  if (item.kind === "rect") {
    const w = (item.x2 - item.x1) * p;
    const h = (item.y2 - item.y1) * p;
    const jx = jitter(item.seed, 3, 1.2);
    const jy = jitter(item.seed, 4, 1.2);
    return (
      <g key={item.id}>
        <rect
          x={item.x1 + jx}
          y={item.y1 + jy}
          width={Math.max(1, w)}
          height={Math.max(1, h)}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width + 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.14 * p}
          rx={8}
        />
        <rect
          x={item.x1}
          y={item.y1}
          width={Math.max(1, w)}
          height={Math.max(1, h)}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5 + 0.5 * p}
          rx={8}
        />
      </g>
    );
  }

  const d = `M ${item.x1} ${item.y1} Q ${mx} ${my} ${x2} ${y2}`;
  const arrow =
    item.kind === "arrow" && p > 0.82 ? (
      <polygon
        points={[
          `${x2},${y2}`,
          `${x2 - 16 * Math.cos(Math.atan2(y2 - item.y1, x2 - item.x1) - 0.4)},${
            y2 - 16 * Math.sin(Math.atan2(y2 - item.y1, x2 - item.x1) - 0.4)
          }`,
          `${x2 - 16 * Math.cos(Math.atan2(y2 - item.y1, x2 - item.x1) + 0.4)},${
            y2 - 16 * Math.sin(Math.atan2(y2 - item.y1, x2 - item.x1) + 0.4)
          }`,
        ].join(" ")}
        fill={item.color}
        opacity={Math.min(1, (p - 0.82) / 0.18)}
      />
    ) : null;

  return (
    <g key={item.id}>
      <path
        d={d}
        fill="none"
        stroke={item.color}
        strokeWidth={item.width + 1.8}
        strokeLinecap="round"
        opacity={0.16}
      />
      <path
        d={d}
        fill="none"
        stroke={item.color}
        strokeWidth={item.width}
        strokeLinecap="round"
        opacity={0.5 + 0.5 * p}
      />
      {arrow}
    </g>
  );
}

export function LiveClassroom({
  locale = "en",
  documentIds = [],
  question = "",
  onClose,
}: {
  locale?: string;
  documentIds?: string[];
  question?: string;
  onClose?: () => void;
}) {
  const router = useRouter();
  const lang = locale.toLowerCase().slice(0, 2);
  const labels =
    presenceLabel[
      lang === "ar" || lang === "ku" ? "ar" : lang === "tr" ? "tr" : "en"
    ]!;
  const rtl = lang === "ar" || lang === "ku";
  // Accept shorter answers, especially for check questions / Arabic.
  const minWords = rtl ? 1 : 2;

  const [session, setSession] = useState<ClassroomSession | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [caption, setCaption] = useState("");
  const [presence, setPresence] = useState<Presence>("thinking");
  const [error, setError] = useState<string | null>(null);
  const [hz, setHz] = useState(() => Array.from({ length: 40 }, () => 0.08));
  const [ended, setEnded] = useState(false);
  const [boardZoom, setBoardZoom] = useState(1);
  const pinchDistRef = useRef<number | null>(null);
  const pinchZoomRef = useRef(1);

  const cancelledRef = useRef(false);
  const voiceBusyRef = useRef(false);
  const handlingTurnRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const countryCodeRef = useRef<string | null>(null);
  const provinceNameRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fatalSpeechErrorRef = useRef(false);
  const loopActiveRef = useRef(false);
  const speechActivityRef = useRef(0);
  const lastAskWaitRef = useRef(0);
  const boardCursorRef = useRef(160);
  const diagramCursorRef = useRef(220);
  const turnStartedRef = useRef(false);
  const pendingAskRef = useRef<string | null>(null);
  // Stays true across the whole ask→wait→answer cycle (unlike pendingAskRef,
  // which the loop clears early to move into the wait state). Used so the
  // student's reply is always bridged with "let me check" first.
  const awaitingCheckRef = useRef(false);
  const bridgeVariantRef = useRef(0);
  const finalBufferRef = useRef("");
  const finalTimerRef = useRef<number | null>(null);
  const clockRef = useRef(0);
  const [, setTick] = useState(0);

  const speakBridge = useCallback(
    async (kind: ClassroomBridgeKind) => {
      const phrase = classroomBridgePhrase(
        locale,
        session?.countryCode ?? countryCodeRef.current,
        session?.provinceName,
        kind,
        bridgeVariantRef.current++
      );
      if (!phrase) return;
      setPresence("speaking");
      setCaption(phrase);
      voiceBusyRef.current = true;
      const wave = window.setInterval(() => {
        const t = Date.now() / 90;
        setHz((prev) =>
          prev.map((_, i) => 0.14 + (Math.sin(t + i * 0.4) * 0.5 + 0.5) * 0.7)
        );
      }, 50);
      await speakCloud(
        phrase,
        locale,
        "normal",
        session?.countryCode ?? countryCodeRef.current,
        bridgeKindToEmotion(kind),
        session?.provinceName ?? provinceNameRef.current
      );
      window.clearInterval(wave);
      voiceBusyRef.current = false;
    },
    [locale, session?.countryCode, session?.provinceName]
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      clockRef.current = nowMs();
      setTick((t) => t + 1);
    }, 33);
    return () => window.clearInterval(id);
  }, []);

  const clampBoardZoom = useCallback((z: number) => Math.max(1, Math.min(3, z)), []);

  const handleBoardWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // Trackpad pinch fires wheel with ctrlKey/metaKey true in every major browser.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setBoardZoom((z) => clampBoardZoom(z - e.deltaY * 0.01));
    },
    [clampBoardZoom]
  );

  const handleBoardTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        pinchDistRef.current = Math.hypot(
          a.clientX - b.clientX,
          a.clientY - b.clientY
        );
        pinchZoomRef.current = boardZoom;
      }
    },
    [boardZoom]
  );

  const handleBoardTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2 && pinchDistRef.current) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const ratio = dist / pinchDistRef.current;
        setBoardZoom(clampBoardZoom(pinchZoomRef.current * ratio));
      }
    },
    [clampBoardZoom]
  );

  const handleBoardTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) pinchDistRef.current = null;
  }, []);

  const stopListen = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
  }, []);

  const playBeat = useCallback(
    async (beat: ClassroomBeat) => {
      if (cancelledRef.current) return;
      stopListen();
      setBoard((prev) => {
        const next = applyActions(
          prev,
          beat.board || [],
          rtl,
          boardCursorRef.current,
          diagramCursorRef.current
        );
        boardCursorRef.current = next.cursorY;
        diagramCursorRef.current = next.diagramCursorY;
        return next.items;
      });
      voiceBusyRef.current = true;
      setPresence("speaking");
      const lines = (beat.speak || []).map(cleanText).filter(Boolean);
      const ask = cleanText(beat.askStudent) || beat.askStudent || "";
      if (ask && !lines.some((l) => l.includes(ask.slice(0, 10)))) {
        lines.push(ask);
      }
      // Pipeline TTS: kick off the fetch for line N+1 as soon as line N
      // starts playing instead of waiting for it to finish first — this
      // removes the "dead air" fetch gap between sentences so the teacher's
      // voice feels like one continuous stream instead of fetch→play→fetch.
      const pace = beat.pace || "normal";
      const emotion = beat.emotion || "calm";
      let nextAudio: Promise<string | null> | null = lines.length
        ? fetchTtsAudioUrl(
            lines[0],
            locale,
            pace,
            countryCodeRef.current,
            emotion,
            provinceNameRef.current
          )
        : null;
      for (let i = 0; i < lines.length; i++) {
        if (cancelledRef.current) break;
        const line = lines[i];
        setCaption(line);
        const wave = window.setInterval(() => {
          const t = Date.now() / 100;
          setHz((prev) =>
            prev.map((_, i) => 0.12 + (Math.sin(t + i * 0.45) * 0.5 + 0.5) * 0.75)
          );
        }, 50);
        const url = await nextAudio;
        // Start fetching the line after next while this one plays.
        nextAudio =
          i + 1 < lines.length
            ? fetchTtsAudioUrl(
                lines[i + 1],
                locale,
                pace,
                countryCodeRef.current,
                emotion,
                provinceNameRef.current
              )
            : null;
        if (url) {
          await playAudioUrl(url);
        } else {
          // Fetch failed — one retry so a single dropped TTS call doesn't
          // silence the teacher mid-beat.
          const retryUrl = await fetchTtsAudioUrl(
            line,
            locale,
            pace,
            countryCodeRef.current,
            emotion,
            provinceNameRef.current
          );
          if (retryUrl) await playAudioUrl(retryUrl);
        }
        window.clearInterval(wave);
        await new Promise((r) => setTimeout(r, 280));
      }
      voiceBusyRef.current = false;
      await new Promise((r) => setTimeout(r, 400));
      if (beat.lessonName) {
        setSession((s) =>
          s
            ? {
                ...s,
                state: { ...s.state, currentLessonName: beat.lessonName },
              }
            : s
        );
      }
      if (ask) {
        lastAskWaitRef.current = Math.max(
          5000,
          Math.min(8000, beat.waitForStudentMs || 5500)
        );
        pendingAskRef.current = ask;
        awaitingCheckRef.current = true;
        setCaption(ask);
      } else {
        lastAskWaitRef.current = 0;
        pendingAskRef.current = null;
        awaitingCheckRef.current = false;
      }
      if (beat.sessionComplete) setEnded(true);
    },
    [locale, rtl, stopListen]
  );

  const submitTurn = useCallback(
    async (transcript: string, opts?: { noAnswer?: boolean }) => {
      if (!sessionIdRef.current || handlingTurnRef.current) return;
      const q = opts?.noAnswer
        ? ""
        : cleanText(transcript) || transcript.trim();
      if (!opts?.noAnswer && !q) return;
      handlingTurnRef.current = true;
      turnStartedRef.current = true;
      finalBufferRef.current = "";
      if (finalTimerRef.current) {
        window.clearTimeout(finalTimerRef.current);
        finalTimerRef.current = null;
      }
      stopListen();
      stopCloudAudio();
      voiceBusyRef.current = false;
      if (!opts?.noAnswer) {
        setPresence("listening");
        setCaption(q);
        await new Promise((r) => setTimeout(r, 120));
      }

      const kind: ClassroomBridgeKind = opts?.noAnswer
        ? "think"
        : awaitingCheckRef.current
          ? "check"
          : "explain";
      // Consumed for this turn — the next beat will re-arm it if another
      // check question is asked (e.g. re-asking after a wrong answer).
      awaitingCheckRef.current = false;
      const apiP = postJsonWithRetry(
        `/api/ai/classroom/session/${sessionIdRef.current}/turn`,
        opts?.noAnswer ? { noAnswer: true } : { transcript: q }
      );

      try {
        await speakBridge(kind);
        const data = await apiP;
        setError(null);
        if (data.session) {
          const session = data.session as ClassroomSession;
          if (session.countryCode) {
            countryCodeRef.current = session.countryCode;
          }
          provinceNameRef.current = session.provinceName ?? provinceNameRef.current;
          setSession(session);
        }
        const beat = data.beat as ClassroomBeat;
        // After "let me check": praise if correct, re-explain bridge if wrong.
        if (kind === "check") {
          if (beat?.answerCorrect === true) {
            await speakBridge("excellent");
          } else if (beat?.answerCorrect === false) {
            await speakBridge("reexplain");
          }
        }
        await playBeat(beat);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Turn failed");
      } finally {
        handlingTurnRef.current = false;
      }
    },
    [playBeat, speakBridge, stopListen]
  );

  const startListen = useCallback(() => {
    if (voiceBusyRef.current || handlingTurnRef.current || ended) return;
    if (fatalSpeechErrorRef.current) return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    if (recognitionRef.current) return;
    try {
      const rec = new Ctor();
      rec.lang = session?.speechLocale || (rtl ? "ar-IQ" : "en-US");
      rec.continuous = true;
      rec.interimResults = true;
      // Ask the engine for multiple candidate transcripts so we can pick the
      // highest-confidence one instead of always trusting alternative #0.
      rec.maxAlternatives = 3;
      // ev.results is CUMULATIVE for this recognition session — rebuild from
      // the session base instead of appending (appending duplicated words).
      const sessionBase = finalBufferRef.current;
      rec.onresult = (ev) => {
        if (voiceBusyRef.current || handlingTurnRef.current) return;
        let finalChunk = "";
        let interim = "";
        for (let i = 0; i < ev.results.length; i++) {
          const row = ev.results[i];
          const alt = bestTranscript(row);
          if (row?.isFinal) finalChunk += `${alt} `;
          else interim += alt;
        }
        if (finalChunk.trim()) {
          finalBufferRef.current = `${sessionBase} ${finalChunk}`
            .replace(/\s+/g, " ")
            .trim();
        }
        const heard = (finalBufferRef.current || interim).trim();
        const words = heard.split(/\s+/).filter(Boolean);
        if (words.length >= 1) {
          speechActivityRef.current = Date.now();
          setPresence("listening");
          setCaption(heard);
          setHz((prev) =>
            prev.map((_, i) => 0.2 + ((i * 17 + Date.now()) % 70) / 100)
          );
        }
        const q = finalBufferRef.current.trim();
        // A short precise answer ("four", "yes", "Paris") is common when a
        // check question is pending — don't force a 2nd word that may never
        // come, which used to make the recognizer merge it with the start of
        // the NEXT utterance and mis-transcribe both.
        const need = pendingAskRef.current ? 1 : Math.max(minWords, 2);
        if (q.split(/\s+/).filter(Boolean).length >= need) {
          if (finalTimerRef.current) window.clearTimeout(finalTimerRef.current);
          // Debounce so multi-phrase answers finish before we cut off.
          finalTimerRef.current = window.setTimeout(() => {
            const ready = finalBufferRef.current.trim();
            if (
              ready &&
              !voiceBusyRef.current &&
              !handlingTurnRef.current &&
              ready.split(/\s+/).filter(Boolean).length >= need
            ) {
              turnStartedRef.current = true;
              void submitTurn(ready);
            }
          }, rtl ? 900 : 700);
        }
      };
      rec.onend = () => {
        recognitionRef.current = null;
        if (
          !cancelledRef.current &&
          !voiceBusyRef.current &&
          !handlingTurnRef.current &&
          !ended &&
          !fatalSpeechErrorRef.current
        ) {
          window.setTimeout(() => startListen(), 220);
        }
      };
      rec.onerror = (ev) => {
        const code = ev?.error || "";
        if (FATAL_SPEECH_ERRORS.has(code)) {
          // Permission denied / mic blocked — stop hammering the browser
          // prompt; surface it once so the student knows why nothing works.
          fatalSpeechErrorRef.current = true;
          setError(
            lang === "ar"
              ? "الرجاء السماح بالوصول إلى الميكروفون"
              : lang === "tr"
                ? "Lütfen mikrofon erişimine izin verin"
                : "Please allow microphone access"
          );
        }
        // Transient errors (no-speech, network, aborted) are recovered by
        // the normal onend → restart cycle below.
      };
      recognitionRef.current = rec;
      setPresence((p) => (p === "speaking" || p === "thinking" ? p : "listening"));
      rec.start();
    } catch {
      /* unsupported */
    }
  }, [ended, minWords, rtl, session?.speechLocale, submitTurn]);

  const waitForStudentWindow = useCallback(
    async (baseMs: number) => {
      speechActivityRef.current = 0;
      turnStartedRef.current = false;
      finalBufferRef.current = "";
      setPresence("waiting");
      startListen();
      const started = Date.now();
      while (!cancelledRef.current && !ended && !handlingTurnRef.current) {
        const active =
          speechActivityRef.current > 0 &&
          Date.now() - speechActivityRef.current < 2200;
        const elapsed = Date.now() - started;
        const deadline = active ? Math.max(baseMs, elapsed + 2000) : baseMs;
        if (elapsed >= deadline && !active) break;
        await new Promise((r) => setTimeout(r, 120));
      }
      if (!handlingTurnRef.current) {
        if (finalTimerRef.current) {
          window.clearTimeout(finalTimerRef.current);
          finalTimerRef.current = null;
        }
        stopListen();
        // Don't lose an answer captured just before the window closed.
        const leftover = finalBufferRef.current.trim();
        if (leftover) {
          turnStartedRef.current = true;
          await submitTurn(leftover);
        }
      }
      return turnStartedRef.current || handlingTurnRef.current;
    },
    [ended, startListen, stopListen, submitTurn]
  );

  const runStudentCheck = useCallback(
    async (question: string, waitMs: number, pace: string) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (cancelledRef.current || ended) return;
        const answered = await waitForStudentWindow(waitMs);
        if (answered || handlingTurnRef.current) {
          while (handlingTurnRef.current && !cancelledRef.current) {
            await new Promise((r) => setTimeout(r, 120));
          }
          return;
        }
        setPresence("speaking");
        setCaption(question);
        voiceBusyRef.current = true;
        await speakCloud(
          question,
          locale,
          "slow",
          countryCodeRef.current,
          "patient",
          provinceNameRef.current
        );
        voiceBusyRef.current = false;
        await new Promise((r) => setTimeout(r, 350));
      }
      if (cancelledRef.current || ended || handlingTurnRef.current) return;
      await submitTurn("", { noAnswer: true });
      void pace;
    },
    [ended, locale, submitTurn, waitForStudentWindow]
  );

  const runLoop = useCallback(async () => {
    if (loopActiveRef.current || !sessionIdRef.current) return;
    loopActiveRef.current = true;
    try {
      while (!cancelledRef.current && !ended && sessionIdRef.current) {
        if (handlingTurnRef.current) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        if (pendingAskRef.current) {
          const q = pendingAskRef.current;
          const waitMs = lastAskWaitRef.current || 5500;
          pendingAskRef.current = null;
          await runStudentCheck(q, waitMs, "normal");
          continue;
        }

        // Beats without a check question are pure explanation — give the
        // student a real window to jump in with a question before moving on.
        const answered = await waitForStudentWindow(4200);
        if (cancelledRef.current || ended) break;
        if (answered || handlingTurnRef.current) {
          while (handlingTurnRef.current && !cancelledRef.current) {
            await new Promise((r) => setTimeout(r, 150));
          }
          continue;
        }

        setPresence("thinking");
        const apiP = postJsonWithRetry(
          `/api/ai/classroom/session/${sessionIdRef.current}/beat`,
          {}
        );
        await speakBridge("think");
        const data = await apiP;
        setError(null);
        const session = data.session as ClassroomSession | undefined;
        if (session) {
          if (session.countryCode) {
            countryCodeRef.current = session.countryCode;
          }
          provinceNameRef.current = session.provinceName ?? provinceNameRef.current;
          setSession(session);
        }
        const beat = data.beat as ClassroomBeat;
        await playBeat(beat);
        if (beat.sessionComplete || session?.status === "ENDED") {
          setEnded(true);
          break;
        }
      }
    } catch (e) {
      // A stalled/aborted request (timeout, dropped wifi) must not freeze
      // the class forever — show a brief status and auto-resume instead of
      // permanently stopping the loop.
      const transient =
        (e instanceof DOMException && e.name === "AbortError") ||
        e instanceof TypeError;
      if (transient && !cancelledRef.current && !ended) {
        setError(
          lang === "ar"
            ? "انقطع الاتصال، جارٍ إعادة المحاولة…"
            : lang === "tr"
              ? "Bağlantı kesildi, yeniden deneniyor…"
              : "Connection hiccup — reconnecting…"
        );
        window.setTimeout(() => {
          if (!cancelledRef.current && !ended) {
            setError(null);
            void runLoop();
          }
        }, 2000);
      } else {
        setError(e instanceof Error ? e.message : "Classroom failed");
      }
    } finally {
      loopActiveRef.current = false;
    }
  }, [ended, lang, playBeat, runStudentCheck, speakBridge, waitForStudentWindow]);

  const startSession = useCallback(async () => {
    setError(null);
    setPresence("thinking");
    try {
      const data = await postJsonWithRetry("/api/ai/classroom/session", {
        language: locale,
        question,
        documentIds,
      });
      if (data.needsMaterialSelection) {
        setError("Select materials first");
        return;
      }
      const session = data.session as ClassroomSession;
      sessionIdRef.current = session.id;
      countryCodeRef.current = session.countryCode || null;
      provinceNameRef.current = session.provinceName || null;
      setSession(session);
      await playBeat(data.beat as ClassroomBeat);
      void runLoop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, question, documentIds, playBeat]);

  useEffect(() => {
    cancelledRef.current = false;
    void startSession();
    return () => {
      cancelledRef.current = true;
      stopListen();
      stopCloudAudio();
      const id = sessionIdRef.current;
      if (id) {
        void fetch(`/api/ai/classroom/session/${id}/end`, { method: "POST" });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = useMemo(() => {
    return (
      session?.state?.currentLessonName ||
      session?.materialNames?.[0] ||
      (lang === "ar"
        ? "الفصل المباشر"
        : lang === "tr"
          ? "Canlı sınıf"
          : "Live classroom")
    );
  }, [lang, session]);

  const clock = clockRef.current;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-[linear-gradient(165deg,#07111f_0%,#0f172a_45%,#0a1628_100%)] text-white"
      dir={rtl ? "rtl" : "ltr"}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300/80">
            U Learn · Classroom
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
            {title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              presence === "listening"
                ? "border-amber-300/40 bg-amber-400/15 text-amber-100"
                : presence === "speaking"
                  ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100"
                  : "border-white/15 bg-white/5 text-slate-200"
            )}
          >
            {labels[presence]}
          </span>
          <button
            type="button"
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/5"
            onClick={() => {
              cancelledRef.current = true;
              stopListen();
              stopCloudAudio();
              if (onClose) onClose();
              else router.back();
            }}
          >
            {lang === "ar" ? "إغلاق" : lang === "tr" ? "Kapat" : "Close"}
          </button>
        </div>
      </header>

      <div className="relative mx-3 min-h-0 flex-1 overflow-hidden rounded-[22px] border border-white/10 bg-[#f7f4ee] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.8)] sm:mx-5">
        <div
          className="h-full w-full overflow-auto"
          style={{ touchAction: boardZoom > 1 ? "pan-x pan-y" : "none" }}
          onWheel={handleBoardWheel}
          onTouchStart={handleBoardTouchStart}
          onTouchMove={handleBoardTouchMove}
          onTouchEnd={handleBoardTouchEnd}
        >
          <svg
            viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
            style={{
              display: "block",
              width: `${boardZoom * 100}%`,
              height: `${boardZoom * 100}%`,
              minWidth: "100%",
              minHeight: "100%",
            }}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <filter id="chalkSoft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="0.6" />
              </filter>
            </defs>
            <rect x={0} y={0} width={BOARD_W} height={BOARD_H} fill="#f7f4ee" />
            {Array.from({ length: 19 }).map((_, i) => (
              <line
                key={`v${i}`}
                x1={(i + 1) * 100}
                y1={0}
                x2={(i + 1) * 100}
                y2={BOARD_H}
                stroke="#e7e0d4"
                strokeWidth={1}
              />
            ))}
            {Array.from({ length: 10 }).map((_, i) => (
              <line
                key={`h${i}`}
                x1={0}
                y1={(i + 1) * 100}
                x2={BOARD_W}
                y2={(i + 1) * 100}
                stroke="#e7e0d4"
                strokeWidth={1}
              />
            ))}
            <g filter="url(#chalkSoft)">
              {board.map((item) => (
                <BoardStroke key={item.id} item={item} clock={clock} />
              ))}
            </g>
          </svg>
        </div>

        <div
          className="absolute top-3 flex flex-col gap-1 rounded-xl border border-white/15 bg-slate-950/70 p-1 backdrop-blur-md"
          style={rtl ? { left: 12 } : { right: 12 }}
        >
          <button
            type="button"
            aria-label="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-semibold text-white/85 hover:bg-white/10"
            onClick={() => setBoardZoom((z) => clampBoardZoom(z + 0.25))}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-semibold text-white/85 hover:bg-white/10"
            onClick={() => setBoardZoom((z) => clampBoardZoom(z - 0.25))}
          >
            −
          </button>
          {boardZoom !== 1 ? (
            <button
              type="button"
              aria-label="Reset zoom"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-semibold text-white/70 hover:bg-white/10"
              onClick={() => setBoardZoom(1)}
            >
              1:1
            </button>
          ) : null}
        </div>

        <div className="absolute inset-x-3 bottom-3 rounded-2xl border border-white/20 bg-slate-950/82 px-4 py-3 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/90">
            {labels[presence]}
          </p>
          <p className="mt-1 text-[15px] font-medium leading-snug text-white sm:text-base">
            {caption || "…"}
          </p>
        </div>
      </div>

      <div className="mx-3 my-3 flex h-9 items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 sm:mx-5">
        <div className="flex h-3.5 flex-1 items-center gap-[2px]" aria-hidden>
          {hz.map((h, i) => (
            <span
              key={i}
              className={cn(
                "min-w-[1.5px] flex-1 rounded-full",
                presence === "listening"
                  ? "bg-amber-300/90"
                  : presence === "speaking"
                    ? "bg-emerald-300/90"
                    : "bg-sky-300/50"
              )}
              style={{ height: `${Math.max(2, Math.round(h * 12))}px` }}
            />
          ))}
        </div>
        <span className="max-w-[40%] truncate text-[10px] font-medium text-white/55">
          {presence === "listening"
            ? labels.listening
            : presence === "waiting"
              ? labels.waiting
              : labels.speaking}
        </span>
      </div>

      {error ? (
        <button
          type="button"
          onClick={!sessionIdRef.current ? () => void startSession() : undefined}
          className={cn(
            "w-full bg-transparent px-5 pb-3 text-center text-xs font-semibold text-rose-300",
            !sessionIdRef.current
              ? "cursor-pointer underline decoration-rose-300/60"
              : "cursor-default"
          )}
        >
          {error}
          {!sessionIdRef.current ? (
            <span className="mt-1 block text-[11px] font-semibold">
              {lang === "ar"
                ? "اضغط لإعادة المحاولة"
                : lang === "tr"
                  ? "Tekrar denemek için dokunun"
                  : "Tap to retry"}
            </span>
          ) : null}
        </button>
      ) : null}
      {ended ? (
        <p className="px-5 pb-4 text-center text-sm font-semibold text-emerald-200">
          {lang === "ar"
            ? "انتهى هذا الجزء من الفصل. يمكنك الإغلاق أو البدء من جديد."
            : lang === "tr"
              ? "Bu sınıf bölümü tamamlandı."
              : "This classroom segment is complete."}
        </p>
      ) : null}
    </div>
  );
}
