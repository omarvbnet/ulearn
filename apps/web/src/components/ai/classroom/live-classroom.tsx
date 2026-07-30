"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

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
  sessionComplete?: boolean;
};

type ClassroomSession = {
  id: string;
  status: string;
  locale: string;
  countryCode: string | null;
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

function nextTextY(items: BoardItem[], rtl: boolean, requested?: number) {
  if (typeof requested === "number" && Number.isFinite(requested) && requested > 40) {
    return requested;
  }
  const texts = items.filter((i) => i.kind === "text") as Extract<
    BoardItem,
    { kind: "text" }
  >[];
  if (!texts.length) return 150;
  const last = texts[texts.length - 1]!;
  return Math.min(980, last.y + Math.max(78, last.size + 48));
}

function applyActions(
  items: BoardItem[],
  actions: BoardAction[],
  rtl: boolean
): BoardItem[] {
  let acc = [...items];
  let penAt = nowMs();
  actions.forEach((cue, idx) => {
    const action = String(cue.action || "").toLowerCase().replace(/\s+/g, "_");
    const p = cue.parameters || {};
    const id = `${Date.now()}-${idx}-${action}`;
    const seed = idx * 97 + Math.floor(num(cue.time, idx) * 3);
    if (action === "clear_board" || action === "open_new_board") {
      acc = [];
      penAt = nowMs();
      return;
    }
    if (
      action === "write_text" ||
      action === "draw_formula" ||
      action === "draw_equation"
    ) {
      const text = cleanText(p.text ?? p.content ?? p.latex);
      if (!text) return;
      const align =
        p.align === "right" || p.align === "left"
          ? (p.align as "left" | "right")
          : rtl
            ? "right"
            : "left";
      const writeMs = Math.max(1100, Math.min(6500, text.length * 78));
      const y = nextTextY(acc, rtl, num(p.y, NaN));
      acc.push({
        kind: "text",
        id,
        text,
        x: num(p.x, align === "right" ? 1780 : 140) + jitter(seed, 1, 2.2),
        y: y + jitter(seed, 2, 2),
        color: resolveColor(p.color),
        size: Math.max(22, Math.min(44, num(p.size, text.length < 18 ? 34 : 28))),
        bornAt: penAt,
        writeMs,
        align,
        seed,
      });
      penAt += writeMs + 220;
      return;
    }
    const color = resolveColor(p.color, "#334155");
    const width = Math.max(2.4, Math.min(8, num(p.width, 3.4)));
    if (action === "highlight") {
      const x1 = num(p.x1, num(p.x, rtl ? 1200 : 120));
      const y1 = num(p.y1, num(p.y, 140));
      const x2 = num(p.x2, x1 + num(p.w, 280));
      const y2 = num(p.y2, y1 + num(p.h, 48));
      acc.push({
        kind: "highlight",
        id,
        x1,
        y1,
        x2,
        y2,
        color: resolveColor(p.color, "#fde047"),
        width: 0,
        bornAt: penAt,
        writeMs: 480,
        seed,
      });
      penAt += 520;
      return;
    }
    if (action === "draw_line" || action === "underline") {
      const baseY = num(p.y1, num(p.y, nextTextY(acc, rtl) - 20));
      acc.push({
        kind: "line",
        id,
        x1: num(p.x1, num(p.x, rtl ? 1780 : 140)) + jitter(seed, 1, 2),
        y1: baseY + jitter(seed, 2, 1.5),
        x2: num(p.x2, num(p.x, rtl ? 1780 : 140) + (rtl ? -320 : 320)) +
          jitter(seed, 3, 2),
        y2: num(p.y2, baseY) + jitter(seed, 4, 1.5),
        color: resolveColor(p.color, "#ea580c"),
        width,
        bornAt: penAt,
        writeMs: 980,
        seed,
      });
      penAt += 1050;
    } else if (action === "draw_arrow") {
      acc.push({
        kind: "arrow",
        id,
        x1: num(p.x1, rtl ? 700 : 1300) + jitter(seed, 1, 3),
        y1: num(p.y1, 480) + jitter(seed, 2, 3),
        x2: num(p.x2, rtl ? 380 : 1620) + jitter(seed, 3, 3),
        y2: num(p.y2, 320) + jitter(seed, 4, 3),
        color: resolveColor(p.color, "#059669"),
        width,
        bornAt: penAt,
        writeMs: 1200,
        seed,
      });
      penAt += 1260;
    } else if (action === "draw_circle" || action === "circle") {
      const cx = num(p.cx, rtl ? 520 : 1480);
      const cy = num(p.cy, 420);
      const r = Math.max(28, num(p.r, 70));
      acc.push({
        kind: "circle",
        id,
        x1: cx - r,
        y1: cy - r,
        x2: cx + r,
        y2: cy + r,
        color: resolveColor(p.color, "#dc2626"),
        width,
        bornAt: penAt,
        writeMs: 1400,
        seed,
      });
      penAt += 1460;
    } else if (action === "draw_rectangle" || action === "draw_rect") {
      const x = num(p.x, num(p.x1, rtl ? 280 : 1280));
      const y = num(p.y, num(p.y1, 300));
      const w = num(p.w, num(p.x2, x + 220) - x);
      const h = num(p.h, num(p.y2, y + 120) - y);
      acc.push({
        kind: "rect",
        id,
        x1: x,
        y1: y,
        x2: x + Math.abs(w),
        y2: y + Math.abs(h),
        color: resolveColor(p.color, "#92400e"),
        width,
        bornAt: penAt,
        writeMs: 1250,
        seed,
      });
      penAt += 1300;
    }
  });
  return acc;
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

let activeCloudAudio: HTMLAudioElement | null = null;

async function speakCloud(
  text: string,
  language: string,
  pace: string
): Promise<boolean> {
  try {
    if (activeCloudAudio) {
      try {
        activeCloudAudio.pause();
      } catch {
        /* ignore */
      }
      activeCloudAudio = null;
    }
    const res = await fetch("/api/ai/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language, pace }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const b64 = data.dataBase64 || data.data?.dataBase64;
    const mime = data.mimeType || data.data?.mimeType || "audio/mpeg";
    if (!b64) return false;
    const url = URL.createObjectURL(base64ToBlob(b64, mime));
    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      activeCloudAudio = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (activeCloudAudio === audio) activeCloudAudio = null;
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (activeCloudAudio === audio) activeCloudAudio = null;
        resolve();
      };
      void audio.play().catch(() => resolve());
    });
    return true;
  } catch {
    return false;
  }
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

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: {
    results: ArrayLike<{
      isFinal?: boolean;
      0?: { transcript?: string };
    }>;
  }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

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
    const cx = (item.x1 + item.x2) / 2;
    const cy = (item.y1 + item.y2) / 2;
    const r = Math.abs(item.x2 - item.x1) / 2;
    const circ = 2 * Math.PI * r;
    return (
      <circle
        key={item.id}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={item.color}
        strokeWidth={item.width}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - p)}
        opacity={0.4 + 0.6 * p}
      />
    );
  }

  if (item.kind === "rect") {
    const w = (item.x2 - item.x1) * p;
    const h = (item.y2 - item.y1) * p;
    return (
      <rect
        key={item.id}
        x={item.x1}
        y={item.y1}
        width={Math.max(1, w)}
        height={Math.max(1, h)}
        fill="none"
        stroke={item.color}
        strokeWidth={item.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.45 + 0.55 * p}
        rx={6}
      />
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
  const minWords = rtl ? 2 : 3;

  const [session, setSession] = useState<ClassroomSession | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [caption, setCaption] = useState("");
  const [presence, setPresence] = useState<Presence>("thinking");
  const [error, setError] = useState<string | null>(null);
  const [hz, setHz] = useState(() => Array.from({ length: 40 }, () => 0.08));
  const [ended, setEnded] = useState(false);

  const cancelledRef = useRef(false);
  const voiceBusyRef = useRef(false);
  const handlingTurnRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const loopActiveRef = useRef(false);
  const speechActivityRef = useRef(0);
  const lastAskWaitRef = useRef(0);
  const clockRef = useRef(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      clockRef.current = nowMs();
      setTick((t) => t + 1);
    }, 33);
    return () => window.clearInterval(id);
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
      setBoard((prev) => applyActions(prev, beat.board || [], rtl));
      voiceBusyRef.current = true;
      setPresence("speaking");
      const lines = (beat.speak || []).map(cleanText).filter(Boolean);
      for (const line of lines) {
        if (cancelledRef.current || handlingTurnRef.current) break;
        setCaption(line);
        const wave = window.setInterval(() => {
          const t = Date.now() / 100;
          setHz((prev) =>
            prev.map((_, i) => 0.12 + (Math.sin(t + i * 0.45) * 0.5 + 0.5) * 0.75)
          );
        }, 50);
        await speakCloud(line, locale, beat.pace || "normal");
        window.clearInterval(wave);
        await new Promise((r) => setTimeout(r, 280));
      }
      voiceBusyRef.current = false;
      // Critical settle before mic — prevents crash / garbled listen
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
      if (beat.askStudent) {
        lastAskWaitRef.current = Math.max(
          4200,
          Math.min(8000, beat.waitForStudentMs || 5000)
        );
        setCaption(cleanText(beat.askStudent) || beat.askStudent);
      } else {
        lastAskWaitRef.current = 0;
      }
      if (beat.sessionComplete) setEnded(true);
    },
    [locale, rtl, stopListen]
  );

  const submitTurn = useCallback(
    async (transcript: string) => {
      const q = cleanText(transcript) || transcript.trim();
      if (!q || !sessionIdRef.current || handlingTurnRef.current) return;
      handlingTurnRef.current = true;
      stopListen();
      stopCloudAudio();
      voiceBusyRef.current = false;
      setPresence("thinking");
      setCaption(q);
      try {
        const res = await fetch(
          `/api/ai/classroom/session/${sessionIdRef.current}/turn`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: q }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Turn failed");
        if (data.session) setSession(data.session);
        await playBeat(data.beat as ClassroomBeat);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Turn failed");
      } finally {
        handlingTurnRef.current = false;
      }
    },
    [playBeat, stopListen]
  );

  const startListen = useCallback(() => {
    if (voiceBusyRef.current || handlingTurnRef.current || ended) return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    if (recognitionRef.current) return;
    try {
      const rec = new Ctor();
      rec.lang = session?.speechLocale || (rtl ? "ar-IQ" : "en-US");
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (ev) => {
        if (voiceBusyRef.current || handlingTurnRef.current) return;
        let finalText = "";
        let interim = "";
        for (let i = 0; i < ev.results.length; i++) {
          const row = ev.results[i];
          const alt = row?.[0]?.transcript || "";
          if (row?.isFinal) finalText += `${alt} `;
          else interim += alt;
        }
        const heard = (finalText || interim).trim();
        const words = heard.split(/\s+/).filter(Boolean);
        if (words.length >= 1) {
          speechActivityRef.current = Date.now();
          setPresence("listening");
          setCaption(heard);
          setHz((prev) =>
            prev.map((_, i) => 0.2 + ((i * 17 + Date.now()) % 70) / 100)
          );
        }
        const q = finalText.trim();
        if (q.split(/\s+/).filter(Boolean).length >= minWords) {
          void submitTurn(q);
        }
      };
      rec.onend = () => {
        recognitionRef.current = null;
        if (
          !cancelledRef.current &&
          !voiceBusyRef.current &&
          !handlingTurnRef.current &&
          !ended
        ) {
          window.setTimeout(() => startListen(), 350);
        }
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
      setPresence("waiting");
      startListen();
      const started = Date.now();
      while (!cancelledRef.current && !ended && !handlingTurnRef.current) {
        const active =
          speechActivityRef.current > 0 &&
          Date.now() - speechActivityRef.current < 2200;
        const elapsed = Date.now() - started;
        const deadline = active ? Math.max(baseMs, elapsed + 1800) : baseMs;
        if (elapsed >= deadline && !active) break;
        await new Promise((r) => setTimeout(r, 120));
      }
      // Keep listening if a turn just started; otherwise pause before thinking
      if (!handlingTurnRef.current) stopListen();
    },
    [ended, startListen, stopListen]
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

        const listenMs = lastAskWaitRef.current || 4200;
        await waitForStudentWindow(listenMs);
        if (cancelledRef.current || ended) break;
        if (handlingTurnRef.current) {
          while (handlingTurnRef.current && !cancelledRef.current) {
            await new Promise((r) => setTimeout(r, 150));
          }
          continue;
        }

        setPresence("thinking");
        const res = await fetch(
          `/api/ai/classroom/session/${sessionIdRef.current}/beat`,
          { method: "POST" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Beat failed");
        if (data.session) setSession(data.session);
        const beat = data.beat as ClassroomBeat;
        await playBeat(beat);
        if (beat.sessionComplete || data.session?.status === "ENDED") {
          setEnded(true);
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Classroom failed");
    } finally {
      loopActiveRef.current = false;
    }
  }, [ended, playBeat, waitForStudentWindow]);

  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      setPresence("thinking");
      try {
        const res = await fetch("/api/ai/classroom/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: locale,
            question,
            documentIds,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to start classroom");
        if (data.needsMaterialSelection) {
          setError("Select materials first");
          return;
        }
        sessionIdRef.current = data.session.id;
        setSession(data.session);
        await playBeat(data.beat as ClassroomBeat);
        void runLoop();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start");
      }
    })();
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
        <svg
          viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
          className="h-full w-full"
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
        <p className="px-5 pb-3 text-center text-xs font-semibold text-rose-300">
          {error}
        </p>
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
