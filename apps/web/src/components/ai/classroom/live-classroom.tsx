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
    }
  | {
      kind: "line" | "arrow" | "circle" | "rect";
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
      bornAt: number;
      writeMs: number;
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
    if (action === "clear_board" || action === "open_new_board") {
      acc = [];
      penAt = nowMs();
      return;
    }
    if (action === "write_text" || action === "draw_formula") {
      const text = cleanText(p.text ?? p.content);
      if (!text) return;
      const align =
        p.align === "right" || p.align === "left"
          ? (p.align as "left" | "right")
          : rtl
            ? "right"
            : "left";
      const writeMs = Math.max(900, Math.min(5000, text.length * 70));
      acc.push({
        kind: "text",
        id,
        text,
        x: num(p.x, align === "right" ? 1780 : 120),
        y: num(p.y, 140 + acc.length * 12),
        color: resolveColor(p.color),
        size: Math.max(18, Math.min(48, num(p.size, 28))),
        bornAt: penAt,
        writeMs,
        align,
      });
      penAt += writeMs + 180;
      return;
    }
    const color = resolveColor(p.color, "#334155");
    const width = Math.max(2, Math.min(8, num(p.width, 3)));
    if (action === "draw_line" || action === "underline") {
      acc.push({
        kind: "line",
        id,
        x1: num(p.x1, num(p.x, 200)),
        y1: num(p.y1, num(p.y, 200)),
        x2: num(p.x2, num(p.x, 200) + 160),
        y2: num(p.y2, num(p.y, 200)),
        color,
        width,
        bornAt: penAt,
        writeMs: 900,
      });
      penAt += 950;
    } else if (action === "draw_arrow") {
      acc.push({
        kind: "arrow",
        id,
        x1: num(p.x1, 400),
        y1: num(p.y1, 400),
        x2: num(p.x2, 700),
        y2: num(p.y2, 300),
        color,
        width,
        bornAt: penAt,
        writeMs: 1100,
      });
      penAt += 1150;
    } else if (action === "draw_circle") {
      const cx = num(p.cx, 500);
      const cy = num(p.cy, 500);
      const r = num(p.r, 60);
      acc.push({
        kind: "circle",
        id,
        x1: cx - r,
        y1: cy - r,
        x2: cx + r,
        y2: cy + r,
        color,
        width,
        bornAt: penAt,
        writeMs: 1200,
      });
      penAt += 1250;
    } else if (action === "draw_rectangle") {
      acc.push({
        kind: "rect",
        id,
        x1: num(p.x, 300),
        y1: num(p.y, 300),
        x2: num(p.x, 300) + num(p.w, 180),
        y2: num(p.y, 300) + num(p.h, 100),
        color,
        width,
        bornAt: penAt,
        writeMs: 1100,
      });
      penAt += 1150;
    }
  });
  return acc;
}

function progressOf(item: BoardItem, clock: number) {
  return Math.max(0, Math.min(1, (clock - item.bornAt) / item.writeMs));
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "audio/mpeg" });
}

async function speakCloud(
  text: string,
  language: string,
  pace: string
): Promise<boolean> {
  try {
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
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      void audio.play().catch(() => resolve());
    });
    return true;
  } catch {
    return false;
  }
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
  const labels = presenceLabel[lang === "ar" || lang === "ku" ? "ar" : lang === "tr" ? "tr" : "en"]!;
  const rtl = lang === "ar" || lang === "ku";

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
  const clockRef = useRef(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      clockRef.current = nowMs();
      setTick((t) => t + 1);
    }, 40);
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
            prev.map((_, i) => 0.1 + (Math.sin(t + i * 0.45) * 0.5 + 0.5) * 0.7)
          );
        }, 50);
        await speakCloud(line, locale, beat.pace || "normal");
        window.clearInterval(wave);
        await new Promise((r) => setTimeout(r, 220));
      }
      voiceBusyRef.current = false;
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
      if (beat.sessionComplete) setEnded(true);
    },
    [locale, rtl]
  );

  const submitTurn = useCallback(
    async (transcript: string) => {
      const q = cleanText(transcript) || transcript.trim();
      if (!q || !sessionIdRef.current || handlingTurnRef.current) return;
      handlingTurnRef.current = true;
      stopListen();
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
    stopListen();
    try {
      const rec = new Ctor();
      rec.lang = session?.speechLocale || (rtl ? "ar-SA" : "en-US");
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
        const words = (finalText || interim).trim().split(/\s+/).filter(Boolean);
        if (words.length >= 2) setPresence("listening");
        const q = finalText.trim();
        if (q.split(/\s+/).filter(Boolean).length >= 3) {
          void submitTurn(q);
        }
      };
      rec.onend = () => {
        if (
          !cancelledRef.current &&
          !voiceBusyRef.current &&
          !handlingTurnRef.current &&
          !ended
        ) {
          window.setTimeout(() => startListen(), 500);
        }
      };
      recognitionRef.current = rec;
      setPresence("listening");
      rec.start();
    } catch {
      /* unsupported */
    }
  }, [ended, rtl, session?.speechLocale, stopListen, submitTurn]);

  const runLoop = useCallback(async () => {
    if (loopActiveRef.current || !sessionIdRef.current) return;
    loopActiveRef.current = true;
    try {
      while (!cancelledRef.current && !ended && sessionIdRef.current) {
        if (handlingTurnRef.current) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        // Listen window between beats
        setPresence("waiting");
        startListen();
        await new Promise((r) => setTimeout(r, 1800));
        stopListen();
        if (cancelledRef.current || handlingTurnRef.current || ended) continue;

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
        if (beat.askStudent) {
          setPresence("waiting");
          setCaption(cleanText(beat.askStudent) || beat.askStudent);
          startListen();
          await new Promise((r) =>
            setTimeout(r, Math.max(1600, beat.waitForStudentMs || 2400))
          );
          stopListen();
        }
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
  }, [ended, playBeat, startListen, stopListen]);

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
      (lang === "ar" ? "الفصل المباشر" : lang === "tr" ? "Canlı sınıf" : "Live classroom")
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
              if (onClose) onClose();
              else router.back();
            }}
          >
            {lang === "ar" ? "إغلاق" : lang === "tr" ? "Kapat" : "Close"}
          </button>
        </div>
      </header>

      <div className="relative mx-3 min-h-0 flex-1 overflow-hidden rounded-[22px] border border-white/10 bg-[#f8fafc] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.8)] sm:mx-5">
        <svg
          viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <rect x={0} y={0} width={BOARD_W} height={BOARD_H} fill="#f8fafc" />
          {Array.from({ length: 19 }).map((_, i) => (
            <line
              key={`v${i}`}
              x1={(i + 1) * 100}
              y1={0}
              x2={(i + 1) * 100}
              y2={BOARD_H}
              stroke="#e8eef5"
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
              stroke="#e8eef5"
              strokeWidth={1}
            />
          ))}
          {board.map((item) => {
            const p = progressOf(item, clock);
            if (p <= 0) return null;
            if (item.kind === "text") {
              const shown = item.text.slice(0, Math.ceil(item.text.length * p));
              return (
                <text
                  key={item.id}
                  x={item.x}
                  y={item.y}
                  fill={item.color}
                  fontSize={item.size}
                  fontFamily="Georgia, 'Times New Roman', serif"
                  textAnchor={item.align === "right" ? "end" : "start"}
                >
                  {shown}
                </text>
              );
            }
            const x2 = item.x1 + (item.x2 - item.x1) * p;
            const y2 = item.y1 + (item.y2 - item.y1) * p;
            if (item.kind === "circle") {
              const cx = (item.x1 + item.x2) / 2;
              const cy = (item.y1 + item.y2) / 2;
              const r = (Math.abs(item.x2 - item.x1) / 2) * p;
              return (
                <circle
                  key={item.id}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.width}
                />
              );
            }
            if (item.kind === "rect") {
              return (
                <rect
                  key={item.id}
                  x={Math.min(item.x1, x2)}
                  y={Math.min(item.y1, y2)}
                  width={Math.abs(x2 - item.x1)}
                  height={Math.abs(y2 - item.y1)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.width}
                />
              );
            }
            return (
              <line
                key={item.id}
                x1={item.x1}
                y1={item.y1}
                x2={x2}
                y2={y2}
                stroke={item.color}
                strokeWidth={item.width}
                strokeLinecap="round"
              />
            );
          })}
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
