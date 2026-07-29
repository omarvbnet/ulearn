"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AiTeacherLessonView } from "./ai-teacher-lesson-card";

const BOARD_W = 1920;
const BOARD_H = 1080;

type Mode = "voice" | "text";
type Phase =
  | "ready"
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
      bornAt: number;
      writeMs: number;
      /** Language-aware alignment for board text. */
      align: "left" | "right";
      /** Stable seed for handwriting jitter. */
      seed: number;
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
      bornAt: number;
      writeMs: number;
    }
  | {
      kind: "circle";
      id: string;
      cx: number;
      cy: number;
      r: number;
      color: string;
      width: number;
      bornAt: number;
      writeMs: number;
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
      bornAt: number;
      writeMs: number;
    }
  | {
      kind: "highlight";
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      bornAt: number;
      writeMs: number;
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
  enableSound: string;
  soundOn: string;
  soundOff: string;
  writing: string;
  tapToBegin: string;
  tapHint: string;
};

function t(locale: string): Labels {
  if (locale === "ar") {
    return {
      classroom: "الفصل المباشر",
      voice: "صوت",
      text: "نص",
      start: "ابدأ الدرس بالصوت",
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
      interruptHint: "يمكنك المقاطعة في أي وقت",
      completed: "أحسنت! انتهينا من هذا الجزء. هل تريد مثالاً آخر؟",
      enableSound: "تفعيل صوت المعلم",
      soundOn: "الصوت يعمل",
      soundOff: "الصوت متوقف",
      writing: "يكتب على السبورة…",
      tapToBegin: "اضغط لبدء الدرس المباشر",
      tapHint: "سيتحدث المعلم ويرسم على السبورة معاً",
    };
  }
  if (locale === "tr") {
    return {
      classroom: "Canlı sınıf",
      voice: "Ses",
      text: "Metin",
      start: "Dersi sesle başlat",
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
      interruptHint: "İstediğin zaman soru sorabilirsin",
      completed: "Harika! Bu bölüm bitti. Başka bir örnek ister misin?",
      enableSound: "Öğretmen sesini aç",
      soundOn: "Ses açık",
      soundOff: "Ses kapalı",
      writing: "Tahtaya yazıyor…",
      tapToBegin: "Canlı derse başlamak için dokun",
      tapHint: "Öğretmen konuşurken tahtaya çizer",
    };
  }
  if (locale === "ku") {
    return {
      classroom: "پۆلی ڕاستەوخۆ",
      voice: "دەنگ",
      text: "دەق",
      start: "وانە بە دەنگ دەستپێبکە",
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
      interruptHint: "لە هەر کاتێک دەتوانیت بپرسیت",
      completed: "زۆر باش! ئەم بەشە تەواو بوو.",
      enableSound: "دەنگی مامۆستا چالاک بکە",
      soundOn: "دەنگ کارا",
      soundOff: "دەنگ ناکارا",
      writing: "لەسەر تەختە دەنووسێت…",
      tapToBegin: "بۆ دەستپێکردنی وانە دەست لێبدە",
      tapHint: "مامۆستا قسە دەکات و لەسەر تەختە دەکێشێت",
    };
  }
  return {
    classroom: "Live classroom",
    voice: "Voice",
    text: "Text",
    start: "Start lesson with voice",
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
    enableSound: "Enable teacher voice",
    soundOn: "Sound on",
    soundOff: "Sound off",
    writing: "Writing on the board…",
    tapToBegin: "Tap to begin live lesson",
    tapHint: "Teacher speaks while drawing on the board",
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
  const lang = normalizeClassroomLang(code);
  if (lang === "ar") return "ar-SA";
  if (lang === "tr") return "tr-TR";
  return "en-US";
}

function normalizeClassroomLang(code?: string | null): "ar" | "tr" | "en" {
  const lang = (code || "en").toLowerCase().slice(0, 2);
  if (lang === "ar" || lang === "ku") return "ar";
  if (lang === "tr") return "tr";
  return "en";
}

function isRtlLang(code?: string | null): boolean {
  return normalizeClassroomLang(code) === "ar";
}

/** Never draw raw JSON / parameter dumps on the board. */
function cleanBoardText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["text", "content", "label", "title", "latex", "value"]) {
      if (typeof o[key] === "string") return cleanBoardText(o[key]);
    }
    return "";
  }
  let s = String(raw).trim();
  if (!s || s === "[object Object]" || s === "undefined" || s === "null") {
    return "";
  }
  if (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(s) as unknown;
      return cleanBoardText(parsed);
    } catch {
      return "";
    }
  }
  if (/^["']?(text|x|y|color|size|action|parameters|cx|cy|width)["']?\s*:/i.test(s)) {
    return "";
  }
  if (/"x"\s*:/.test(s) && /"y"\s*:/.test(s)) return "";
  if (s.includes('"parameters"') || s.includes('"action"')) return "";
  // Strip accidental code fences
  s = s.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  return s.slice(0, 180);
}

function estimateSpeakMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1800, Math.min(12000, words * 380));
}

function writeDurationForText(text: string): number {
  // Slower, more human handwriting pace
  return Math.max(700, Math.min(4800, text.length * 48));
}

function strokeWriteMs(kind: "line" | "arrow" | "circle" | "rect" | "highlight"): number {
  switch (kind) {
    case "highlight":
      return 420;
    case "line":
      return 900;
    case "arrow":
      return 1100;
    case "circle":
      return 1300;
    case "rect":
      return 1200;
  }
}

/** Deterministic wobble so strokes feel hand-drawn, not CAD-perfect. */
function handJitter(seed: number, i: number, amp = 4.5): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return ((x - Math.floor(x)) * 2 - 1) * amp;
}

function humanLinePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number
): string {
  const mx = (x1 + x2) / 2 + handJitter(seed, 1, 10);
  const my = (y1 + y2) / 2 + handJitter(seed, 2, 10);
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function applyCue(
  items: BoardItem[],
  cue: AiTeacherLessonView["whiteboard"][number],
  idx: number,
  bornAt: number,
  rtl: boolean
): BoardItem[] {
  const p = cue.parameters || {};
  const action = String(cue.action || "").toLowerCase().replace(/\s+/g, "_");
  const id = `${cue.time}-${action}-${idx}`;
  const seed = idx * 97 + Math.round(Number(cue.time) || 0);

  if (action === "clear_board" || action === "open_new_board") return [];
  if (
    action === "wait" ||
    action === "change_color" ||
    action === "change_pen_size" ||
    action === "laser_pointer" ||
    action === "pointer_move" ||
    action === "zoom" ||
    action === "pan" ||
    action === "insert_image" ||
    action === "insert_icon"
  ) {
    return items;
  }

  if (action === "write_text" || action === "draw_formula" || action === "draw_equation") {
    const text = cleanBoardText(p.text ?? p.latex ?? p.content ?? p.title);
    if (!text) return items;
    const align =
      p.align === "right" || p.align === "left"
        ? (p.align as "left" | "right")
        : rtl
          ? "right"
          : "left";
    const defaultX = align === "right" ? 1780 : 120;
    return [
      ...items,
      {
        kind: "text",
        id,
        text,
        x: num(p.x, defaultX),
        y: num(p.y, 120) + handJitter(seed, 3, 2.2),
        color: resolveColor(p.color, "#1e3a8a"),
        size: Math.max(18, Math.min(56, num(p.size, 30))),
        bornAt,
        writeMs: writeDurationForText(text),
        align,
        seed,
      },
    ];
  }

  if (action === "draw_line" || action === "underline") {
    return [
      ...items,
      {
        kind: "line",
        id,
        x1: num(p.x1, 0) + handJitter(seed, 1, 2),
        y1: num(p.y1, 0) + handJitter(seed, 2, 2),
        x2: num(p.x2, 100) + handJitter(seed, 3, 2),
        y2: num(p.y2, 100) + handJitter(seed, 4, 2),
        color: resolveColor(p.color, "#334155"),
        width: num(p.width, 3.2),
        bornAt,
        writeMs: strokeWriteMs("line"),
      },
    ];
  }

  if (action === "draw_arrow") {
    return [
      ...items,
      {
        kind: "arrow",
        id,
        x1: num(p.x1, 0) + handJitter(seed, 1, 2),
        y1: num(p.y1, 0) + handJitter(seed, 2, 2),
        x2: num(p.x2, 100) + handJitter(seed, 3, 2),
        y2: num(p.y2, 100) + handJitter(seed, 4, 2),
        color: resolveColor(p.color, "#ca8a04"),
        width: num(p.width, 3.2),
        bornAt,
        writeMs: strokeWriteMs("arrow"),
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
          cx: num(p.cx, 200) + handJitter(seed, 1, 3),
          cy: num(p.cy, 200) + handJitter(seed, 2, 3),
          r: num(p.r, 40),
          color: resolveColor(p.color, "#dc2626"),
          width: num(p.width, 3.2),
          bornAt,
          writeMs: strokeWriteMs("circle"),
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
        width: num(p.width, 3.2),
        bornAt,
        writeMs: strokeWriteMs("circle"),
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
        x: Math.min(x1, x2) + handJitter(seed, 1, 2),
        y: Math.min(y1, y2) + handJitter(seed, 2, 2),
        w: Math.abs(x2 - x1) || 120,
        h: Math.abs(y2 - y1) || 80,
        color: resolveColor(p.color, "#92400e"),
        width: num(p.width, 3.2),
        bornAt,
        writeMs: strokeWriteMs("rect"),
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
        bornAt,
        writeMs: strokeWriteMs("highlight"),
      },
    ];
  }

  if (action === "erase") return items.slice(0, Math.max(0, items.length - 1));
  return items;
}

function progressOf(item: BoardItem, clock: number): number {
  const p = (clock - item.bornAt) / Math.max(1, item.writeMs);
  return Math.max(0, Math.min(1, p));
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 2.4);
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

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const primary = lang.slice(0, 2).toLowerCase();
  return (
    voices.find((v) => v.lang?.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(primary)) ||
    voices.find((v) => v.default) ||
    voices[0] ||
    null
  );
}

/** Keep a strong ref so Chrome does not GC the utterance mid-speech. */
let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeCloudAudio: HTMLAudioElement | null = null;

function clearTtsWatch() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __ulearnTtsTimer?: ReturnType<typeof setInterval> };
  if (w.__ulearnTtsTimer) {
    clearInterval(w.__ulearnTtsTimer);
    w.__ulearnTtsTimer = undefined;
  }
}

function startTtsWatch() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  clearTtsWatch();
  const w = window as unknown as { __ulearnTtsTimer?: ReturnType<typeof setInterval> };
  // Chrome quirk: speechSynthesis pauses silently after ~15s without resume().
  w.__ulearnTtsTimer = setInterval(() => {
    try {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
    } catch {
      /* ignore */
    }
  }, 3500);
}

async function fetchCloudSpeech(
  text: string,
  language: string
): Promise<{ mimeType: string; dataBase64: string; durationMs?: number } | null> {
  try {
    const res = await fetch("/api/ai/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language: normalizeClassroomLang(language) }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      mimeType?: string;
      dataBase64?: string;
      durationMs?: number;
    };
    if (!data.dataBase64 || !data.mimeType) return null;
    return {
      mimeType: data.mimeType,
      dataBase64: data.dataBase64,
      durationMs: data.durationMs,
    };
  } catch {
    return null;
  }
}

export function AiTeacherClassroom({
  lesson,
  locale = "en",
  onAskTeacher,
}: {
  lesson: AiTeacherLessonView;
  locale?: string;
  onAskTeacher?: (input: {
    question: string;
    pausedSpeechIndex: number;
    spokenSoFar: string[];
    lessonTitle: string;
  }) => Promise<string>;
}) {
  const labels = useMemo(() => t(locale), [locale]);
  const [mode, setMode] = useState<Mode>("voice");
  const [phase, setPhase] = useState<Phase>("ready");
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [clock, setClock] = useState(0);
  const [caption, setCaption] = useState("");
  const [speechIndex, setSpeechIndex] = useState(0);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [teacherReply, setTeacherReply] = useState<string | null>(null);
  const [quizReveal, setQuizReveal] = useState<Record<number, boolean>>({});
  const [asking, setAsking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);

  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);
  const speechIdxRef = useRef(0);
  const boardAppliedRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const runIdRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const boardItemsRef = useRef<BoardItem[]>([]);
  const soundEnabledRef = useRef(false);
  const modeRef = useRef<Mode>("voice");

  const speech = useMemo(
    () =>
      (lesson.speech || [])
        .map((s) => ({
          time: Math.max(0, Number(s.time) || 0),
          text: cleanBoardText(s.text) || String(s.text || "").trim(),
        }))
        .filter((s) => s.text && !s.text.startsWith("{")),
    [lesson.speech]
  );

  const whiteboard = useMemo(
    () =>
      [...(lesson.whiteboard || [])]
        .map((a) => ({
          ...a,
          action: String(a.action || "").toLowerCase().replace(/\s+/g, "_"),
          parameters:
            a.parameters && typeof a.parameters === "object" ? a.parameters : {},
        }))
        .sort((a, b) => a.time - b.time),
    [lesson.whiteboard]
  );

  const stopVoice = useCallback(() => {
    clearTtsWatch();
    activeUtterance = null;
    if (activeCloudAudio) {
      try {
        activeCloudAudio.pause();
        activeCloudAudio.src = "";
      } catch {
        /* ignore */
      }
      activeCloudAudio = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const unlockVoice = useCallback(() => {
    // Prefer cloud AI voice; still warm device TTS as fallback unlock.
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const synth = window.speechSynthesis;
      synth.getVoices();
      try {
        const warm = new SpeechSynthesisUtterance(" ");
        warm.volume = 0;
        warm.rate = 2;
        warm.lang = speechLang(locale);
        activeUtterance = warm;
        synth.speak(warm);
        synth.resume();
      } catch {
        /* cloud path still works */
      }
    }
    soundEnabledRef.current = true;
    setSoundEnabled(true);
    setVoiceReady(true);
    setMode("voice");
    modeRef.current = "voice";
    return true;
  }, [locale]);

  const speakDevice = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis) {
          resolve();
          return;
        }
        const clean = cleanBoardText(text) || text.trim();
        if (!clean) {
          resolve();
          return;
        }
        const synth = window.speechSynthesis;
        try {
          synth.cancel();
        } catch {
          /* ignore */
        }
        const utter = new SpeechSynthesisUtterance(clean);
        activeUtterance = utter;
        const lang = speechLang(lesson.language || locale);
        utter.lang = lang;
        utter.rate = 0.94;
        utter.pitch = 1;
        utter.volume = 1;
        const voice = pickVoice(lang);
        if (voice) utter.voice = voice;

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTtsWatch();
          if (activeUtterance === utter) activeUtterance = null;
          resolve();
        };
        const safety = window.setTimeout(finish, estimateSpeakMs(clean) + 5000);
        utter.onend = () => {
          window.clearTimeout(safety);
          finish();
        };
        utter.onerror = () => {
          window.clearTimeout(safety);
          finish();
        };

        startTtsWatch();
        try {
          synth.speak(utter);
          synth.resume();
          window.setTimeout(() => {
            try {
              synth.resume();
            } catch {
              /* ignore */
            }
          }, 80);
        } catch {
          window.clearTimeout(safety);
          finish();
        }
      }),
    [lesson.language, locale]
  );

  const speak = useCallback(
    async (text: string) => {
      if (!soundEnabledRef.current || modeRef.current !== "voice") return;
      const clean = cleanBoardText(text) || text.trim();
      if (!clean) return;

      stopVoice();
      const lang = normalizeClassroomLang(lesson.language || locale);
      const cloud = await fetchCloudSpeech(clean, lang);
      if (cloud) {
        await new Promise<void>((resolve) => {
          const audio = new Audio(`data:${cloud.mimeType};base64,${cloud.dataBase64}`);
          activeCloudAudio = audio;
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (activeCloudAudio === audio) activeCloudAudio = null;
            resolve();
          };
          const safety = window.setTimeout(
            finish,
            (cloud.durationMs || estimateSpeakMs(clean)) + 4000
          );
          audio.onended = () => {
            window.clearTimeout(safety);
            finish();
          };
          audio.onerror = () => {
            window.clearTimeout(safety);
            finish();
          };
          audio.play().catch(() => {
            window.clearTimeout(safety);
            finish();
          });
        });
        return;
      }
      await speakDevice(clean);
    },
    [lesson.language, locale, speakDevice, stopVoice]
  );

  const setBoardSmooth = useCallback((items: BoardItem[]) => {
    boardItemsRef.current = items;
    setBoard(items);
  }, []);

  /** Append only new cues (keeps handwriting animation on prior strokes). */
  const applyBoardUntil = useCallback(
    (untilMs: number) => {
      let next = boardAppliedRef.current;
      const born = nowMs();
      let acc = boardItemsRef.current;
      let changed = false;
      const rtl = isRtlLang(lesson.language || locale);
      while (next < whiteboard.length && whiteboard[next]!.time <= untilMs) {
        acc = applyCue(
          acc,
          whiteboard[next]!,
          next,
          born + (next - boardAppliedRef.current) * 55,
          rtl
        );
        next += 1;
        changed = true;
      }
      if (!changed) return;
      boardAppliedRef.current = next;
      setBoardSmooth(acc);
    },
    [setBoardSmooth, whiteboard, lesson.language, locale]
  );

  const resetBoardProgress = useCallback(() => {
    boardAppliedRef.current = 0;
    setBoardSmooth([]);
  }, [setBoardSmooth]);

  // 60fps clock for handwriting progress.
  useEffect(() => {
    const tick = () => {
      setClock(nowMs());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      if (window.speechSynthesis.getVoices().length) setVoiceReady(true);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const waitWhilePaused = useCallback(async () => {
    while (pausedRef.current && !cancelledRef.current) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }, []);

  const runLesson = useCallback(
    async (fromIndex = 0) => {
      const runId = ++runIdRef.current;
      cancelledRef.current = false;
      pausedRef.current = false;
      setPhase("teaching");
      setTeacherReply(null);
      setAskOpen(false);

      if (fromIndex === 0) {
        resetBoardProgress();
        applyBoardUntil(speech[0]?.time ?? 0);
      }

      for (let i = fromIndex; i < speech.length; i++) {
        if (runId !== runIdRef.current || cancelledRef.current) return;

        const cue = speech[i]!;
        speechIdxRef.current = i;
        setSpeechIndex(i);
        setCaption(cue.text);

        const nextTime =
          speech[i + 1]?.time ?? cue.time + estimateSpeakMs(cue.text);
        applyBoardUntil(cue.time + 200);

        const useVoice = modeRef.current === "voice" && soundEnabledRef.current;
        // Speak ASAP (especially first cue) so it stays tied to the tap gesture.
        const speakPromise = useVoice ? speak(cue.text) : Promise.resolve();

        await waitWhilePaused();
        if (runId !== runIdRef.current || cancelledRef.current) {
          stopVoice();
          return;
        }

        const start = nowMs();
        const maxWait = useVoice
          ? estimateSpeakMs(cue.text) + 2500
          : Math.max(
              1600,
              Math.min(estimateSpeakMs(cue.text), nextTime - cue.time || 3500)
            );

        while (nowMs() - start < maxWait) {
          if (runId !== runIdRef.current || cancelledRef.current) {
            stopVoice();
            return;
          }
          await waitWhilePaused();
          if (pausedRef.current) continue;

          const elapsed = nowMs() - start;
          const span = Math.max(900, nextTime - cue.time);
          applyBoardUntil(cue.time + Math.min(span, elapsed + 400));

          if (useVoice) {
            const speaking =
              Boolean(activeCloudAudio && !activeCloudAudio.paused) ||
              window.speechSynthesis?.speaking ||
              window.speechSynthesis?.pending;
            if (!speaking && elapsed > 700) break;
          } else if (elapsed >= Math.min(span, estimateSpeakMs(cue.text))) {
            break;
          }
          await new Promise((r) => setTimeout(r, 32));
        }

        await speakPromise;
        applyBoardUntil(nextTime);
      }

      if (runId !== runIdRef.current || cancelledRef.current) return;
      applyBoardUntil(Number.POSITIVE_INFINITY);
      setPhase("completed");
      setCaption(labels.completed);
      if (modeRef.current === "voice" && soundEnabledRef.current) {
        await speak(labels.completed);
      }
    },
    [
      applyBoardUntil,
      labels.completed,
      resetBoardProgress,
      speak,
      speech,
      stopVoice,
      waitWhilePaused,
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

  function startWithVoice() {
    unlockVoice();
    void runLesson(0);
  }

  function pauseTeaching() {
    pausedRef.current = true;
    stopVoice();
    setPhase("paused");
  }

  function resumeTeaching() {
    setAskOpen(false);
    setTeacherReply(null);
    pausedRef.current = false;
    setPhase("teaching");
    void runLesson(speechIdxRef.current);
  }

  function startListening() {
    pauseTeaching();
    setAskOpen(true);
    setPhase("listening");
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
      rec.onerror = () => setPhase("paused");
      rec.onend = () => setPhase("paused");
      recognitionRef.current = rec;
      rec.start();
    } catch {
      /* text fallback */
    }
  }

  async function submitQuestion() {
    const q = askText.trim();
    if (!q || asking) return;
    recognitionRef.current?.stop();
    setAsking(true);
    setPhase("answering");
    pauseTeaching();
    try {
      const spokenSoFar = speech.slice(0, speechIdxRef.current + 1).map((s) => s.text);
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
      if (modeRef.current === "voice" && soundEnabledRef.current) await speak(reply);
    } finally {
      setAsking(false);
      setPhase("paused");
    }
  }

  const dir = isRtlLang(lesson.language || locale) ? "rtl" : "ltr";
  const boardRtl = isRtlLang(lesson.language || locale);

  const isWriting = board.some((b) => progressOf(b, clock) < 1) && phase === "teaching";

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-emerald-400/20 bg-[radial-gradient(ellipse_at_top,_#10261f_0%,_#071018_55%,_#050b12_100%)] text-slate-100 shadow-[0_25px_80px_-20px_rgba(16,185,129,0.35)]"
      dir={dir}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300/90">
            U Learn · {labels.classroom}
          </p>
          <h4 className="truncate text-base font-semibold leading-tight tracking-tight">
            {lesson.lesson_title}
          </h4>
          {lesson.objective ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">
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
                "rounded-full px-2.5 py-1 font-semibold transition",
                mode === "voice"
                  ? "bg-emerald-500/30 text-emerald-50"
                  : "text-slate-400"
              )}
              onClick={() => unlockVoice()}
            >
              {labels.voice}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-full px-2.5 py-1 font-semibold transition",
                mode === "text"
                  ? "bg-emerald-500/30 text-emerald-50"
                  : "text-slate-400"
              )}
              onClick={() => {
                stopVoice();
                soundEnabledRef.current = false;
                setSoundEnabled(false);
                setMode("text");
                modeRef.current = "text";
              }}
            >
              {labels.text}
            </button>
          </div>
          <button
            type="button"
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              soundEnabled
                ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                : "border-amber-400/40 bg-amber-400/15 text-amber-100"
            )}
            onClick={() => {
              if (soundEnabled) {
                stopVoice();
                soundEnabledRef.current = false;
                setSoundEnabled(false);
              } else {
                unlockVoice();
              }
            }}
          >
            {soundEnabled ? labels.soundOn : labels.enableSound}
          </button>
          {phase === "ready" || phase === "completed" ? (
            <button
              type="button"
              className="rounded-full bg-emerald-400 px-3.5 py-1.5 text-xs font-bold text-emerald-950 shadow-lg shadow-emerald-500/25"
              onClick={() => startWithVoice()}
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
              className="rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-bold text-emerald-950"
              onClick={resumeTeaching}
            >
              {teacherReply ? labels.continue : labels.resume}
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

      <div className="relative mx-3 mt-3 overflow-hidden rounded-2xl border border-emerald-500/15 bg-[#f4f7fb] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-emerald-950/15 to-transparent" />
        <svg
          viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
          className="aspect-[16/10] h-auto w-full"
          role="img"
          aria-label={lesson.lesson_title}
        >
          <defs>
            <filter id="softInk" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.35" />
            </filter>
          </defs>
          <rect x={0} y={0} width={BOARD_W} height={BOARD_H} fill="#f7fafc" />
          {Array.from({ length: 19 }).map((_, i) => (
            <line
              key={`v-${i}`}
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
              key={`h-${i}`}
              x1={0}
              y1={(i + 1) * 100}
              x2={BOARD_W}
              y2={(i + 1) * 100}
              stroke="#e8eef5"
              strokeWidth={1}
            />
          ))}

          {board.map((item) => {
            const p = easeOut(progressOf(item, clock));
            if (p <= 0) return null;

            if (item.kind === "highlight") {
              return (
                <rect
                  key={item.id}
                  x={item.x}
                  y={item.y}
                  width={item.w * p}
                  height={item.h}
                  fill={item.color}
                  opacity={0.35 * p}
                />
              );
            }

            if (item.kind === "text") {
              const chars = Math.max(1, Math.floor(item.text.length * p));
              const shown = item.text.slice(0, chars);
              const rtlText = item.align === "right" || boardRtl;
              return (
                <text
                  key={item.id}
                  x={item.x}
                  y={item.y}
                  fill={item.color}
                  fontSize={item.size}
                  fontFamily={
                    rtlText
                      ? "'Noto Naskh Arabic', 'Segoe UI', Tahoma, Arial, sans-serif"
                      : "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
                  }
                  fontWeight={600}
                  opacity={0.4 + 0.6 * p}
                  textAnchor={rtlText ? "end" : "start"}
                  direction={rtlText ? "rtl" : "ltr"}
                  style={{ unicodeBidi: "plaintext" }}
                >
                  {shown}
                  {p < 1 ? (
                    <tspan fill="#10b981" fontWeight={700}>
                      |
                    </tspan>
                  ) : null}
                </text>
              );
            }

            if (item.kind === "circle") {
              const circ = 2 * Math.PI * item.r;
              return (
                <circle
                  key={item.id}
                  cx={item.cx}
                  cy={item.cy}
                  r={item.r}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.width}
                  strokeDasharray={circ}
                  strokeDashoffset={circ * (1 - p)}
                  strokeLinecap="round"
                  filter="url(#softInk)"
                />
              );
            }

            if (item.kind === "rect") {
              const peri = 2 * (item.w + item.h);
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
                  strokeDasharray={peri}
                  strokeDashoffset={peri * (1 - p)}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  filter="url(#softInk)"
                />
              );
            }

            const x2 = item.x1 + (item.x2 - item.x1) * p;
            const y2 = item.y1 + (item.y2 - item.y1) * p;
            const seed =
              Number.parseInt(item.id.replace(/\D/g, "").slice(-6) || "1", 10) || 1;
            return (
              <g key={item.id}>
                <path
                  d={humanLinePath(item.x1, item.y1, x2, y2, seed)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#softInk)"
                />
                {item.kind === "arrow" && p > 0.85 ? (
                  <polygon
                    points={(() => {
                      const angle = Math.atan2(y2 - item.y1, x2 - item.x1);
                      const size = 14 + item.width;
                      const a1 = angle - Math.PI / 7;
                      const a2 = angle + Math.PI / 7;
                      return `${x2},${y2} ${x2 - size * Math.cos(a1)},${y2 - size * Math.sin(a1)} ${x2 - size * Math.cos(a2)},${y2 - size * Math.sin(a2)}`;
                    })()}
                    fill={item.color}
                    opacity={(p - 0.85) / 0.15}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {isWriting ? (
          <div className="absolute bottom-3 start-3 rounded-full bg-slate-900/70 px-3 py-1 text-[11px] font-semibold text-emerald-200 backdrop-blur">
            {labels.writing}
          </div>
        ) : null}

        {phase === "ready" ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-b from-slate-950/55 via-slate-950/40 to-emerald-950/50 backdrop-blur-[2px]">
            <button
              type="button"
              onClick={() => startWithVoice()}
              className="group mx-4 flex max-w-md flex-col items-center gap-3 rounded-3xl border border-emerald-300/30 bg-slate-950/85 px-8 py-7 text-center shadow-[0_20px_60px_-15px_rgba(16,185,129,0.55)] transition hover:scale-[1.02] hover:border-emerald-300/50"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-400/40 transition group-hover:scale-105">
                <svg
                  viewBox="0 0 24 24"
                  className="ms-0.5 h-8 w-8 fill-current"
                  aria-hidden
                >
                  <path d="M8 5.14v13.72L19 12 8 5.14z" />
                </svg>
              </span>
              <span className="text-lg font-bold tracking-tight text-white">
                {labels.tapToBegin}
              </span>
              <span className="text-sm text-emerald-100/80">{labels.tapHint}</span>
              <span className="text-[11px] font-medium text-slate-400">
                {labels.interruptHint}
              </span>
            </button>
          </div>
        ) : null}

        {(phase === "listening" || phase === "answering") && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/30 backdrop-blur-[1px]">
            <div className="rounded-2xl bg-slate-950/90 px-4 py-3 text-sm font-semibold text-emerald-100">
              {phase === "listening" ? labels.listening : labels.teacherReply}
            </div>
          </div>
        )}
      </div>

      <div className="mx-3 mt-3 mb-3 rounded-2xl border border-emerald-400/15 bg-white/[0.06] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-300/80">
            {phase === "completed"
              ? labels.summary
              : mode === "voice"
                ? labels.voice
                : labels.text}
            {speech.length
              ? ` · ${Math.min(speechIndex + 1, speech.length)}/${speech.length}`
              : ""}
          </p>
          {voiceReady && soundEnabled ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300/90">
              Live voice
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[15px] leading-relaxed text-slate-50">{caption || "…"}</p>
      </div>

      {askOpen && (
        <div className="mx-3 mb-3 space-y-2 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3">
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
              className="rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-bold text-emerald-950 disabled:opacity-50"
            >
              {asking ? "…" : labels.send}
            </button>
          </div>
          {teacherReply ? (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm">
              <p className="text-[11px] font-semibold text-emerald-300">
                {labels.teacherReply}
              </p>
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
        <div className="mx-3 mb-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-xs font-semibold text-slate-300">{labels.summary}</p>
          <ul className="mt-1 list-disc space-y-1 ps-4 text-sm text-slate-200">
            {lesson.summary.map((s, i) => (
              <li key={i}>{cleanBoardText(s) || s}</li>
            ))}
          </ul>
        </div>
      )}

      {phase === "completed" && lesson.quiz?.length > 0 && (
        <div className="mx-3 mb-3 space-y-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-xs font-semibold text-slate-300">{labels.quiz}</p>
          {lesson.quiz.map((q, qi) => (
            <div
              key={qi}
              className="rounded-xl border border-white/10 bg-slate-950/40 p-2.5"
            >
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
    </div>
  );
}
