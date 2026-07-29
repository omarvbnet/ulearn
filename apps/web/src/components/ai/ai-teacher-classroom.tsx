"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AiTeacherLessonView } from "./ai-teacher-lesson-card";

const BOARD_W = 1920;
const BOARD_H = 1080;

type Mode = "voice" | "text";
type Phase =
  | "idle"
  | "teaching"
  | "paused"
  | "listening"
  | "answering"
  | "completed";

type BoardItem =
  | {
      kind: "text";
      id: string;
      text: string;
      x: number;
      y: number;
      color: string;
      size: number;
    }
  | {
      kind: "line" | "arrow";
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
    }
  | {
      kind: "circle";
      id: string;
      cx: number;
      cy: number;
      r: number;
      color: string;
      width: number;
    }
  | {
      kind: "rect";
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      width: number;
    }
  | {
      kind: "highlight";
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    };

type Labels = {
  classroom: string;
  voice: string;
  text: string;
  start: string;
  pause: string;
  resume: string;
  ask: string;
  listening: string;
  stopListen: string;
  send: string;
  continue: string;
  objective: string;
  quiz: string;
  summary: string;
  showAnswer: string;
  hideAnswer: string;
  placeholder: string;
  teacherReply: string;
  interruptHint: string;
  completed: string;
};

function t(locale: string): Labels {
  if (locale === "ar") {
    return {
      classroom: "الفصل المباشر",
      voice: "صوت",
      text: "نص",
      start: "ابدأ الدرس",
      pause: "إيقاف مؤقت",
      resume: "متابعة",
      ask: "اسأل المعلم",
      listening: "أستمع إليك…",
      stopListen: "إيقاف الاستماع",
      send: "إرسال",
      continue: "متابعة الدرس",
      objective: "الهدف",
      quiz: "اختبار سريع",
      summary: "الملخص",
      showAnswer: "أظهر الإجابة",
      hideAnswer: "إخفاء الإجابة",
      placeholder: "اكتب سؤالك للمعلم…",
      teacherReply: "رد المعلم",
      interruptHint: "يمكنك المقاطعة في أي وقت بصوتك أو بالكتابة",
      completed: "أحسنت! انتهينا من هذا الجزء. هل تريد مثالاً آخر؟",
    };
  }
  if (locale === "tr") {
    return {
      classroom: "Canlı sınıf",
      voice: "Ses",
      text: "Metin",
      start: "Dersi başlat",
      pause: "Duraklat",
      resume: "Devam",
      ask: "Öğretmene sor",
      listening: "Seni dinliyorum…",
      stopListen: "Dinlemeyi durdur",
      send: "Gönder",
      continue: "Derse devam",
      objective: "Hedef",
      quiz: "Mini quiz",
      summary: "Özet",
      showAnswer: "Cevabı göster",
      hideAnswer: "Cevabı gizle",
      placeholder: "Öğretmene sorunu yaz…",
      teacherReply: "Öğretmen yanıtı",
      interruptHint: "İstediğin zaman sesinle veya yazarak soru sorabilirsin",
      completed: "Harika! Bu bölüm bitti. Başka bir örnek ister misin?",
    };
  }
  if (locale === "ku") {
    return {
      classroom: "پۆلی ڕاستەوخۆ",
      voice: "دەنگ",
      text: "دەق",
      start: "دەستپێکردنی وانە",
      pause: "وەستان",
      resume: "بەردەوامبوون",
      ask: "پرسیار لە مامۆستا بکە",
      listening: "گوێت لێدەگرم…",
      stopListen: "وەستانی گوێگرتن",
      send: "ناردن",
      continue: "بەردەوامی وانە",
      objective: "ئامانج",
      quiz: "تاقیکردنەوەی کورت",
      summary: "پوختە",
      showAnswer: "وەڵام پیشان بدە",
      hideAnswer: "وەڵام بشارەوە",
      placeholder: "پرسیارەکەت بنووسە…",
      teacherReply: "وەڵامی مامۆستا",
      interruptHint: "لە هەر کاتێک دەتوانیت بە دەنگ یان نووسین بپرسیت",
      completed: "زۆر باش! ئەم بەشە تەواو بوو. نموونەیەکی تر دەتەوێت؟",
    };
  }
  return {
    classroom: "Live classroom",
    voice: "Voice",
    text: "Text",
    start: "Start lesson",
    pause: "Pause",
    resume: "Resume",
    ask: "Ask teacher",
    listening: "Listening…",
    stopListen: "Stop listening",
    send: "Send",
    continue: "Continue lesson",
    objective: "Objective",
    quiz: "Mini quiz",
    summary: "Summary",
    showAnswer: "Show answer",
    hideAnswer: "Hide answer",
    placeholder: "Type your question for the teacher…",
    teacherReply: "Teacher reply",
    interruptHint: "Interrupt anytime by voice or text",
    completed: "Well done! This part is complete. Want another example?",
  };
}

function resolveColor(raw: unknown, fallback = "#1e293b"): string {
  const c = String(raw ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    blue: "#2563eb",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#ca8a04",
    purple: "#7c3aed",
    orange: "#ea580c",
    brown: "#92400e",
    gray: "#64748b",
    grey: "#64748b",
    black: "#0f172a",
    white: "#f8fafc",
    pink: "#db2777",
  };
  if (map[c]) return map[c]!;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return c;
  return fallback;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function speechLang(code?: string): string {
  if (code === "ar") return "ar-SA";
  if (code === "tr") return "tr-TR";
  if (code === "ku") return "ku";
  return "en-US";
}

function estimateMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2200, Math.min(14000, words * 420));
}

function applyCue(
  items: BoardItem[],
  cue: AiTeacherLessonView["whiteboard"][number],
  idx: number
): BoardItem[] {
  const p = cue.parameters || {};
  const action = String(cue.action || "").toLowerCase().replace(/\s+/g, "_");
  const id = `${cue.time}-${action}-${idx}`;

  if (action === "clear_board" || action === "open_new_board") {
    return [];
  }
  if (action === "wait" || action === "change_color" || action === "change_pen_size") {
    return items;
  }
  if (action === "write_text" || action === "draw_formula" || action === "draw_equation") {
    const text = String(p.text ?? p.latex ?? "").trim();
    if (!text) return items;
    return [
      ...items,
      {
        kind: "text",
        id,
        text,
        x: num(p.x, 80),
        y: num(p.y, 80),
        color: resolveColor(p.color, "#1e3a8a"),
        size: num(p.size, 28),
      },
    ];
  }
  if (action === "draw_line" || action === "underline") {
    return [
      ...items,
      {
        kind: "line",
        id,
        x1: num(p.x1, 0),
        y1: num(p.y1, 0),
        x2: num(p.x2, 100),
        y2: num(p.y2, 100),
        color: resolveColor(p.color, "#334155"),
        width: num(p.width, 3),
      },
    ];
  }
  if (action === "draw_arrow") {
    return [
      ...items,
      {
        kind: "arrow",
        id,
        x1: num(p.x1, 0),
        y1: num(p.y1, 0),
        x2: num(p.x2, 100),
        y2: num(p.y2, 100),
        color: resolveColor(p.color, "#ca8a04"),
        width: num(p.width, 3),
      },
    ];
  }
  if (action === "draw_circle" || action === "circle") {
    if (p.cx != null || p.cy != null || p.r != null) {
      return [
        ...items,
        {
          kind: "circle",
          id,
          cx: num(p.cx, 200),
          cy: num(p.cy, 200),
          r: num(p.r, 40),
          color: resolveColor(p.color, "#dc2626"),
          width: num(p.width, 3),
        },
      ];
    }
    const x1 = num(p.x1, 0);
    const y1 = num(p.y1, 0);
    const x2 = num(p.x2, 100);
    const y2 = num(p.y2, 100);
    return [
      ...items,
      {
        kind: "circle",
        id,
        cx: (x1 + x2) / 2,
        cy: (y1 + y2) / 2,
        r: Math.max(8, Math.hypot(x2 - x1, y2 - y1) / 2),
        color: resolveColor(p.color, "#dc2626"),
        width: num(p.width, 3),
      },
    ];
  }
  if (action === "draw_rectangle" || action === "draw_rect") {
    const x1 = num(p.x1, num(p.x, 0));
    const y1 = num(p.y1, num(p.y, 0));
    const x2 = num(p.x2, x1 + num(p.w, 120));
    const y2 = num(p.y2, y1 + num(p.h, 80));
    return [
      ...items,
      {
        kind: "rect",
        id,
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1) || 120,
        h: Math.abs(y2 - y1) || 80,
        color: resolveColor(p.color, "#92400e"),
        width: num(p.width, 3),
      },
    ];
  }
  if (action === "highlight") {
    const x1 = num(p.x1, 0);
    const y1 = num(p.y1, 0);
    const x2 = num(p.x2, x1 + 120);
    const y2 = num(p.y2, y1 + 40);
    return [
      ...items,
      {
        kind: "highlight",
        id,
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1) || 120,
        h: Math.abs(y2 - y1) || 36,
        color: resolveColor(p.color, "#fde047"),
      },
    ];
  }
  if (action === "erase") {
    // Soft erase: drop last item if no region given.
    return items.slice(0, Math.max(0, items.length - 1));
  }
  return items;
}

function ArrowHead({
  x1,
  y1,
  x2,
  y2,
  color,
  width,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 14 + width;
  const a1 = angle - Math.PI / 7;
  const a2 = angle + Math.PI / 7;
  const p1 = `${x2},${y2}`;
  const p2 = `${x2 - size * Math.cos(a1)},${y2 - size * Math.sin(a1)}`;
  const p3 = `${x2 - size * Math.cos(a2)},${y2 - size * Math.sin(a2)}`;
  return <polygon points={`${p1} ${p2} ${p3}`} fill={color} />;
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function AiTeacherClassroom({
  lesson,
  locale = "en",
  onAskTeacher,
}: {
  lesson: AiTeacherLessonView;
  locale?: string;
  /** Called when student interrupts with a question. Return teacher reply text. */
  onAskTeacher?: (input: {
    question: string;
    pausedSpeechIndex: number;
    spokenSoFar: string[];
    lessonTitle: string;
  }) => Promise<string>;
}) {
  const labels = useMemo(() => t(locale), [locale]);
  const [mode, setMode] = useState<Mode>("voice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [caption, setCaption] = useState("");
  const [speechIndex, setSpeechIndex] = useState(0);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [teacherReply, setTeacherReply] = useState<string | null>(null);
  const [quizReveal, setQuizReveal] = useState<Record<number, boolean>>({});
  const [asking, setAsking] = useState(false);

  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);
  const listeningRef = useRef(false);
  const speechIdxRef = useRef(0);
  const boardAppliedRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const runIdRef = useRef(0);

  const speech = lesson.speech || [];
  const whiteboard = useMemo(
    () => [...(lesson.whiteboard || [])].sort((a, b) => a.time - b.time),
    [lesson.whiteboard]
  );

  const stopVoice = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speak = useCallback(
    (text: string, lang?: string) =>
      new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis) {
          resolve();
          return;
        }
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = speechLang(lang || lesson.language || locale);
        utter.rate = 0.95;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
      }),
    [lesson.language, locale]
  );

  const applyBoardUntil = useCallback(
    (untilMs: number) => {
      let next = boardAppliedRef.current;
      let items = null as BoardItem[] | null;
      while (next < whiteboard.length && whiteboard[next]!.time <= untilMs) {
        if (!items) items = [];
        // Rebuild from scratch for open_new_board/clear; otherwise append.
        // Simpler: keep functional updates via accumulator from current applied count.
        next += 1;
      }
      if (next === boardAppliedRef.current) return;
      let acc: BoardItem[] = [];
      for (let i = 0; i < next; i++) {
        acc = applyCue(acc, whiteboard[i]!, i);
      }
      boardAppliedRef.current = next;
      setBoard(acc);
    },
    [whiteboard]
  );

  const resetBoardProgress = useCallback(() => {
    boardAppliedRef.current = 0;
    setBoard([]);
  }, []);

  const waitWhilePaused = useCallback(async () => {
    while (pausedRef.current && !cancelledRef.current) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }, []);

  const runLesson = useCallback(
    async (fromIndex = 0) => {
      const runId = ++runIdRef.current;
      cancelledRef.current = false;
      pausedRef.current = false;
      setPhase("teaching");
      setTeacherReply(null);

      if (fromIndex === 0) {
        resetBoardProgress();
        applyBoardUntil(speech[0]?.time ?? 0);
      }

      for (let i = fromIndex; i < speech.length; i++) {
        if (runId !== runIdRef.current || cancelledRef.current) return;
        await waitWhilePaused();
        if (runId !== runIdRef.current || cancelledRef.current) return;

        const cue = speech[i]!;
        speechIdxRef.current = i;
        setSpeechIndex(i);
        setCaption(cue.text);
        applyBoardUntil(cue.time);

        // Reveal board actions that happen during this spoken segment.
        const nextTime = speech[i + 1]?.time ?? Number.POSITIVE_INFINITY;
        const midActions = whiteboard.filter(
          (a) => a.time > cue.time && a.time < nextTime
        );

        if (mode === "voice") {
          const speakPromise = speak(cue.text);
          // Progressively apply mid-segment board cues while speaking.
          const start = performance.now();
          const span = Math.max(800, nextTime - cue.time);
          while (true) {
            if (runId !== runIdRef.current || cancelledRef.current) {
              stopVoice();
              return;
            }
            await waitWhilePaused();
            if (pausedRef.current) continue;
            const elapsed = performance.now() - start;
            const tMs = cue.time + Math.min(span, elapsed);
            applyBoardUntil(tMs);
            if (elapsed >= estimateMs(cue.text) && midActions.length === 0) break;
            // Prefer waiting for speech end.
            const stillSpeaking =
              typeof window !== "undefined" &&
              window.speechSynthesis &&
              (window.speechSynthesis.speaking || window.speechSynthesis.pending);
            if (!stillSpeaking && elapsed > 400) break;
            await new Promise((r) => setTimeout(r, 80));
          }
          await speakPromise;
        } else {
          const duration = estimateMs(cue.text);
          const start = performance.now();
          while (performance.now() - start < duration) {
            if (runId !== runIdRef.current || cancelledRef.current) return;
            await waitWhilePaused();
            if (pausedRef.current) continue;
            const elapsed = performance.now() - start;
            applyBoardUntil(cue.time + elapsed);
            await new Promise((r) => setTimeout(r, 80));
          }
        }

        applyBoardUntil(nextTime === Number.POSITIVE_INFINITY ? cue.time + 60_000 : nextTime);
      }

      if (runId !== runIdRef.current || cancelledRef.current) return;
      applyBoardUntil(Number.POSITIVE_INFINITY);
      setPhase("completed");
      setCaption(labels.completed);
      if (mode === "voice") {
        await speak(labels.completed);
      }
    },
    [
      applyBoardUntil,
      labels.completed,
      mode,
      resetBoardProgress,
      speech,
      speak,
      stopVoice,
      waitWhilePaused,
      whiteboard,
    ]
  );

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      runIdRef.current += 1;
      stopVoice();
      recognitionRef.current?.stop();
    };
  }, [stopVoice]);

  // Auto-start classroom when lesson mounts (real class feel).
  useEffect(() => {
    void runLesson(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.lesson_title, lesson.speech?.length]);

  function pauseTeaching() {
    pausedRef.current = true;
    stopVoice();
    setPhase("paused");
  }

  function resumeTeaching() {
    setAskOpen(false);
    setTeacherReply(null);
    pausedRef.current = false;
    if (phase === "paused" || phase === "answering" || phase === "listening") {
      setPhase("teaching");
      // Resume from current cue (re-speak current if needed).
      void runLesson(speechIdxRef.current);
    }
  }

  function startListening() {
    pauseTeaching();
    setAskOpen(true);
    setPhase("listening");
    listeningRef.current = true;
    const Ctor = getSpeechRecognition();
    if (!Ctor || mode !== "voice") return;
    try {
      const rec = new Ctor();
      rec.lang = speechLang(lesson.language || locale);
      rec.continuous = false;
      rec.interimResults = true;
      rec.onresult = (ev) => {
        const parts: string[] = [];
        for (let i = 0; i < ev.results.length; i++) {
          const alt = ev.results[i]?.[0]?.transcript;
          if (alt) parts.push(alt);
        }
        setAskText(parts.join(" ").trim());
      };
      rec.onerror = () => {
        listeningRef.current = false;
        setPhase("paused");
      };
      rec.onend = () => {
        listeningRef.current = false;
        if (phase === "listening") setPhase("paused");
      };
      recognitionRef.current = rec;
      rec.start();
    } catch {
      /* mic unavailable — text still works */
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    listeningRef.current = false;
    setPhase("paused");
  }

  async function submitQuestion() {
    const q = askText.trim();
    if (!q || asking) return;
    recognitionRef.current?.stop();
    setAsking(true);
    setPhase("answering");
    pauseTeaching();
    try {
      const spokenSoFar = speech
        .slice(0, speechIdxRef.current + 1)
        .map((s) => s.text);
      let reply =
        locale === "ar"
          ? "سؤال ممتاز. دعنا نوضح هذه النقطة ثم نكمل من حيث توقفنا."
          : "Excellent question. Let’s clarify this, then continue from where we paused.";
      if (onAskTeacher) {
        reply = await onAskTeacher({
          question: q,
          pausedSpeechIndex: speechIdxRef.current,
          spokenSoFar,
          lessonTitle: lesson.lesson_title,
        });
      }
      setTeacherReply(reply);
      setAskText("");
      if (mode === "voice") {
        await speak(reply);
      }
    } finally {
      setAsking(false);
      setPhase("paused");
    }
  }

  const dir =
    lesson.language === "ar" ||
    lesson.language === "ku" ||
    locale === "ar" ||
    locale === "ku"
      ? "rtl"
      : "ltr";

  return (
    <div
      className="mt-3 overflow-hidden rounded-2xl border border-emerald-500/30 bg-[#0b1220] text-slate-100 shadow-xl"
      dir={dir}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300/90">
            U Learn · {labels.classroom}
          </p>
          <h4 className="text-base font-semibold leading-tight">{lesson.lesson_title}</h4>
          {lesson.objective ? (
            <p className="mt-0.5 text-xs text-slate-400">
              <span className="font-medium text-slate-300">{labels.objective}: </span>
              {lesson.objective}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-full border border-white/15 bg-white/5 p-0.5 text-xs">
            <button
              type="button"
              className={cn(
                "rounded-full px-2.5 py-1 font-semibold",
                mode === "voice" ? "bg-emerald-500/25 text-emerald-100" : "text-slate-400"
              )}
              onClick={() => setMode("voice")}
            >
              {labels.voice}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-full px-2.5 py-1 font-semibold",
                mode === "text" ? "bg-emerald-500/25 text-emerald-100" : "text-slate-400"
              )}
              onClick={() => {
                stopVoice();
                setMode("text");
              }}
            >
              {labels.text}
            </button>
          </div>
          {phase === "idle" || phase === "completed" ? (
            <button
              type="button"
              className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-950"
              onClick={() => void runLesson(0)}
            >
              {labels.start}
            </button>
          ) : null}
          {phase === "teaching" ? (
            <button
              type="button"
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold"
              onClick={pauseTeaching}
            >
              {labels.pause}
            </button>
          ) : null}
          {phase === "paused" || phase === "answering" ? (
            <button
              type="button"
              className="rounded-full bg-emerald-500/90 px-3 py-1.5 text-xs font-bold text-emerald-950"
              onClick={resumeTeaching}
            >
              {phase === "answering" || teacherReply ? labels.continue : labels.resume}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-100"
            onClick={() => {
              if (mode === "voice") startListening();
              else {
                pauseTeaching();
                setAskOpen(true);
              }
            }}
          >
            {phase === "listening" ? labels.listening : labels.ask}
          </button>
        </div>
      </div>

      <p className="px-3 pt-2 text-[11px] text-slate-500">{labels.interruptHint}</p>

      {/* Live whiteboard */}
      <div className="relative mx-3 mt-2 aspect-[16/10] overflow-hidden rounded-xl border border-white/10 bg-[#f4f7fb]">
        <svg
          viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
          className="h-full w-full"
          role="img"
          aria-label={lesson.lesson_title}
        >
          <rect x={0} y={0} width={BOARD_W} height={BOARD_H} fill="#f4f7fb" />
          {/* subtle grid */}
          {Array.from({ length: 19 }).map((_, i) => (
            <line
              key={`v-${i}`}
              x1={(i + 1) * 100}
              y1={0}
              x2={(i + 1) * 100}
              y2={BOARD_H}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: 10 }).map((_, i) => (
            <line
              key={`h-${i}`}
              x1={0}
              y1={(i + 1) * 100}
              x2={BOARD_W}
              y2={(i + 1) * 100}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
          ))}
          {board.map((item) => {
            if (item.kind === "highlight") {
              return (
                <rect
                  key={item.id}
                  x={item.x}
                  y={item.y}
                  width={item.w}
                  height={item.h}
                  fill={item.color}
                  opacity={0.45}
                />
              );
            }
            if (item.kind === "text") {
              return (
                <text
                  key={item.id}
                  x={item.x}
                  y={item.y}
                  fill={item.color}
                  fontSize={item.size}
                  fontFamily="ui-sans-serif, system-ui, Tahoma, Arial"
                >
                  {item.text}
                </text>
              );
            }
            if (item.kind === "circle") {
              return (
                <circle
                  key={item.id}
                  cx={item.cx}
                  cy={item.cy}
                  r={item.r}
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
                  x={item.x}
                  y={item.y}
                  width={item.w}
                  height={item.h}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.width}
                />
              );
            }
            return (
              <g key={item.id}>
                <line
                  x1={item.x1}
                  y1={item.y1}
                  x2={item.x2}
                  y2={item.y2}
                  stroke={item.color}
                  strokeWidth={item.width}
                  strokeLinecap="round"
                />
                {item.kind === "arrow" ? (
                  <ArrowHead
                    x1={item.x1}
                    y1={item.y1}
                    x2={item.x2}
                    y2={item.y2}
                    color={item.color}
                    width={item.width}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
        {(phase === "listening" || phase === "answering") && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/35 backdrop-blur-[1px]">
            <div className="rounded-2xl bg-slate-950/85 px-4 py-3 text-sm font-semibold text-emerald-100">
              {phase === "listening" ? labels.listening : labels.teacherReply}
            </div>
          </div>
        )}
      </div>

      {/* Teacher caption / current spoken line */}
      <div className="mx-3 mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300/80">
          {phase === "completed"
            ? labels.summary
            : mode === "voice"
              ? labels.voice
              : labels.text}
          {speech.length ? ` · ${Math.min(speechIndex + 1, speech.length)}/${speech.length}` : ""}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate-100">{caption || "…"}</p>
      </div>

      {askOpen && (
        <div className="mx-3 mt-2 space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
          <div className="flex flex-wrap gap-2">
            {mode === "voice" && phase === "listening" ? (
              <button
                type="button"
                className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold"
                onClick={stopListening}
              >
                {labels.stopListen}
              </button>
            ) : null}
          </div>
          <textarea
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            rows={2}
            placeholder={labels.placeholder}
            className="w-full resize-none rounded-xl border border-white/15 bg-slate-950/50 px-3 py-2 text-sm outline-none focus:border-emerald-400/50"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={!askText.trim() || asking}
              onClick={() => void submitQuestion()}
              className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-950 disabled:opacity-50"
            >
              {asking ? "…" : labels.send}
            </button>
          </div>
          {teacherReply ? (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm">
              <p className="text-[11px] font-semibold text-emerald-300">{labels.teacherReply}</p>
              <p className="mt-1 text-slate-100">{teacherReply}</p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-emerald-200 underline"
                onClick={resumeTeaching}
              >
                {labels.continue}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {phase === "completed" && lesson.summary?.length > 0 && (
        <div className="mx-3 mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-xs font-semibold text-slate-300">{labels.summary}</p>
          <ul className="mt-1 list-disc space-y-1 ps-4 text-sm text-slate-200">
            {lesson.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {phase === "completed" && lesson.quiz?.length > 0 && (
        <div className="mx-3 my-3 space-y-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-xs font-semibold text-slate-300">{labels.quiz}</p>
          {lesson.quiz.map((q, qi) => (
            <div key={qi} className="rounded-lg border border-white/10 bg-slate-950/40 p-2.5">
              <p className="text-sm font-medium">
                {qi + 1}. {q.question}
              </p>
              {q.choices?.length > 0 && (
                <ul className="mt-1 space-y-1 text-sm text-slate-300">
                  {q.choices.map((c, ci) => (
                    <li key={ci}>
                      {String.fromCharCode(65 + ci)}. {c}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-emerald-300 hover:underline"
                onClick={() =>
                  setQuizReveal((prev) => ({ ...prev, [qi]: !prev[qi] }))
                }
              >
                {quizReveal[qi] ? labels.hideAnswer : labels.showAnswer}
              </button>
              {quizReveal[qi] ? (
                <p className="mt-1 text-sm text-emerald-200">{q.answer}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {phase !== "completed" ? <div className="h-3" /> : null}
    </div>
  );
}
