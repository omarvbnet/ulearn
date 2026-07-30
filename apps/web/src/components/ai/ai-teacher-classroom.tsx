"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AiTeacherLessonView } from "./ai-teacher-lesson-card";

const BOARD_W = 1920;
const BOARD_H = 1080;

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
  liveVoice: string;
  voiceMissing: string;
  phaseReady: string;
  phaseTeaching: string;
  phasePaused: string;
  phaseListening: string;
  phaseAnswering: string;
  phaseCompleted: string;
  progress: string;
  closeAsk: string;
};

function normalizeUiLocale(locale?: string | null): "ar" | "tr" | "en" {
  const lang = (locale || "en").toLowerCase().slice(0, 2);
  if (lang === "ar" || lang === "ku") return "ar";
  if (lang === "tr") return "tr";
  return "en";
}

function t(locale: string): Labels {
  const ui = normalizeUiLocale(locale);
  if (ui === "ar") {
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
      interruptHint: "تحدث في أي وقت — المعلم يستمع أولاً ثم يكمل الدرس",
      completed: "أحسنت. هل نجرب مثالاً آخر معاً، أم نكمل الجزء التالي؟",
      enableSound: "تفعيل الصوت",
      soundOn: "الصوت يعمل",
      soundOff: "الصوت متوقف",
      writing: "يكتب على السبورة…",
      tapToBegin: "ادخل الفصل المباشر",
      tapHint: "معلم حقيقي: يتحدث ويرسم ويسأل ويستمع إليك",
      liveVoice: "فصل مباشر",
      voiceMissing: "صوت المعلم غير متاح. عيّن VOICE_TTS (ElevenLabs/OpenAI) من لوحة الإدارة.",
      phaseReady: "جاهز",
      phaseTeaching: "يشرح",
      phasePaused: "متوقف",
      phaseListening: "يستمع إليك",
      phaseAnswering: "يناقش",
      phaseCompleted: "اكتمل",
      progress: "التقدم",
      closeAsk: "إغلاق",
    };
  }
  if (ui === "tr") {
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
      interruptHint: "İstediğin zaman konuş — öğretmen önce dinler, sonra derse devam eder",
      completed: "Harika. Bir örnek daha mı yapalım, yoksa sonraki bölüme mi geçelim?",
      enableSound: "Sesi aç",
      soundOn: "Ses açık",
      soundOff: "Ses kapalı",
      writing: "Tahtaya yazıyor…",
      tapToBegin: "Canlı sınıfa gir",
      tapHint: "Gerçek bir öğretmen: konuşur, çizer, sorar ve seni dinler",
      liveVoice: "Canlı sınıf",
      voiceMissing: "Öğretmen sesi yok. Yönetim panelinden VOICE_TTS (ElevenLabs/OpenAI) atayın.",
      phaseReady: "Hazır",
      phaseTeaching: "Anlatıyor",
      phasePaused: "Duraklatıldı",
      phaseListening: "Seni dinliyor",
      phaseAnswering: "Tartışıyor",
      phaseCompleted: "Tamamlandı",
      progress: "İlerleme",
      closeAsk: "Kapat",
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
    interruptHint: "Speak anytime — the teacher listens first, then continues the lesson",
    completed: "Beautiful work. Shall we try one more example together, or continue to the next part?",
    enableSound: "Enable sound",
    soundOn: "Sound on",
    soundOff: "Sound off",
    writing: "Writing on the board…",
    tapToBegin: "Enter the live classroom",
    tapHint: "A real teacher: speaks, draws, asks, and listens to you",
    liveVoice: "Live classroom",
    voiceMissing: "AI voice unavailable. Assign VOICE_TTS (ElevenLabs/OpenAI) in admin.",
    phaseReady: "Ready",
    phaseTeaching: "Teaching",
    phasePaused: "Paused",
    phaseListening: "Listening to you",
    phaseAnswering: "Discussing",
    phaseCompleted: "Completed",
    progress: "Progress",
    closeAsk: "Close",
  };
}

export function classroomOverlayLabels(locale?: string | null) {
  const ui = normalizeUiLocale(locale);
  if (ui === "ar") {
    return { classroom: "الفصل المباشر", closeBoard: "إغلاق السبورة" };
  }
  if (ui === "tr") {
    return { classroom: "Canlı sınıf", closeBoard: "Tahtayı kapat" };
  }
  return { classroom: "Live classroom", closeBoard: "Close board" };
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

function speechLang(code?: string, speechLocale?: string | null): string {
  if (speechLocale && /^[a-z]{2}(-[A-Z]{2})?$/i.test(speechLocale)) {
    return speechLocale;
  }
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

function selectedSpeechLanguage(code?: string | null): "ar" | "tr" | "en" | "ku" {
  const lang = (code || "en").toLowerCase().slice(0, 2);
  if (lang === "ar") return "ar";
  if (lang === "ku") return "ku";
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
  // Block schema dumps that leaked from failed JSON fallbacks
  if (
    /\b(language|lesson_title|objective|whiteboard|speech|quiz|summary|parameters|action)\s*:/i.test(
      s
    )
  ) {
    return "";
  }
  s = s
    .replace(/,?\s*text\s*:\s*/gi, " ")
    .replace(/,?\s*time\s*:\s*\d+/gi, " ")
    .trim();
  if (/^["']?(text|x|y|color|size|action|parameters|cx|cy|width|time)["']?\s*:/i.test(s)) {
    return "";
  }
  if (/"x"\s*:/.test(s) && /"y"\s*:/.test(s)) return "";
  if (s.includes('"parameters"') || s.includes('"action"')) return "";
  s = s.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  const first = (s.split(/\n/)[0] || s).split(/(?<=[.!?؟。])\s+/)[0] || s;
  s = first.replace(/\s+/g, " ").trim();
  if (s.length < 2) return "";
  return s.slice(0, 90);
}

function estimateSpeakMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1800, Math.min(12000, words * 380));
}

function writeDurationForText(text: string): number {
  // Slower, more human handwriting pace — finish every character.
  return Math.max(1100, Math.min(6500, text.length * 72));
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
  onresult:
    | ((ev: {
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal?: boolean }
        >;
      }) => void)
    | null;
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

/** Keep a strong ref so Chrome does not GC mid-playback. */
let activeCloudAudio: HTMLAudioElement | null = null;
let activeCloudObjectUrl: string | null = null;
let voiceBusy = false;

function clearTtsWatch() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __ulearnTtsTimer?: ReturnType<typeof setInterval> };
  if (w.__ulearnTtsTimer) {
    clearInterval(w.__ulearnTtsTimer);
    w.__ulearnTtsTimer = undefined;
  }
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "audio/mpeg" });
}

async function fetchCloudSpeech(
  text: string,
  language: string
): Promise<{
  mimeType: string;
  dataBase64: string;
  durationMs?: number;
  speechLocale?: string;
} | null> {
  try {
    const res = await fetch("/api/ai/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: selectedSpeechLanguage(language),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      mimeType?: string;
      dataBase64?: string;
      durationMs?: number;
      speechLocale?: string;
      data?: {
        mimeType?: string;
        dataBase64?: string;
        durationMs?: number;
        speechLocale?: string;
      };
    };
    const mimeType = data.mimeType || data.data?.mimeType;
    const dataBase64 = data.dataBase64 || data.data?.dataBase64;
    const durationMs = data.durationMs ?? data.data?.durationMs;
    const speechLocale = data.speechLocale || data.data?.speechLocale;
    if (!dataBase64 || !mimeType) return null;
    return { mimeType, dataBase64, durationMs, speechLocale };
  } catch {
    return null;
  }
}

async function fetchVoiceProfile(language: string): Promise<{
  speechLocale: string;
  accent: string;
  countryCode: string | null;
} | null> {
  try {
    const res = await fetch(
      `/api/ai/voice-profile?language=${encodeURIComponent(selectedSpeechLanguage(language))}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      speechLocale?: string;
      accent?: string;
      countryCode?: string | null;
      data?: {
        speechLocale?: string;
        accent?: string;
        countryCode?: string | null;
      };
    };
    const speechLocale = data.speechLocale || data.data?.speechLocale;
    if (!speechLocale) return null;
    return {
      speechLocale,
      accent: data.accent || data.data?.accent || "default",
      countryCode: data.countryCode ?? data.data?.countryCode ?? null,
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
    documentIds?: string[];
    curriculumOutline?: string[];
    materialNames?: string[];
  }) => Promise<{ answer: string; board?: Array<{ time?: number; action: string; parameters?: Record<string, unknown> }> } | string>;
}) {
  const labels = useMemo(() => t(locale), [locale]);
  const [phase, setPhase] = useState<Phase>("ready");
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [clock, setClock] = useState(0);
  const [caption, setCaption] = useState("");
  const [speechIndex, setSpeechIndex] = useState(0);
  const [teacherReply, setTeacherReply] = useState<string | null>(null);
  const [quizReveal, setQuizReveal] = useState<Record<number, boolean>>({});
  const [asking, setAsking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [hzBars, setHzBars] = useState<number[]>(() => Array.from({ length: 36 }, () => 0.08));
  const [handsFree, setHandsFree] = useState(true);
  const [speechLocale, setSpeechLocale] = useState<string | null>(null);
  const speechLocaleRef = useRef<string | null>(null);

  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);
  const speechIdxRef = useRef(0);
  const boardAppliedRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const runIdRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const boardItemsRef = useRef<BoardItem[]>([]);
  const soundEnabledRef = useRef(false);
  const handsFreeRef = useRef(true);
  const handlingInterruptRef = useRef(false);
  const alwaysListenRef = useRef<SpeechRecognitionLike | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const hzRafRef = useRef<number | null>(null);
  const interimBufRef = useRef("");
  const phaseRef = useRef<Phase>("ready");
  const startAlwaysListenRef = useRef<() => void>(() => {});

  const speech = useMemo(
    () =>
      (lesson.speech || [])
        .map((s) => ({
          time: Math.max(0, Number(s.time) || 0),
          text: cleanBoardText(s.text),
        }))
        .filter((s) => Boolean(s.text)),
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
    voiceBusy = false;
    if (activeCloudAudio) {
      try {
        activeCloudAudio.pause();
        activeCloudAudio.src = "";
      } catch {
        /* ignore */
      }
      activeCloudAudio = null;
    }
    if (activeCloudObjectUrl) {
      try {
        URL.revokeObjectURL(activeCloudObjectUrl);
      } catch {
        /* ignore */
      }
      activeCloudObjectUrl = null;
    }
  }, []);

  const unlockVoice = useCallback(() => {
    // Unlock audio playback for admin VOICE_TTS (cloud) — no device TTS.
    soundEnabledRef.current = true;
    setSoundEnabled(true);
    setVoiceError(null);
    return true;
  }, []);

  const stopHzMonitor = useCallback(() => {
    if (hzRafRef.current) {
      cancelAnimationFrame(hzRafRef.current);
      hzRafRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setHzBars(Array.from({ length: 18 }, () => 0.1));
    setMicLevel(0);
  }, []);

  const startHzMonitor = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    if (analyserRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      micStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        const node = analyserRef.current;
        if (!node) return;
        node.getByteFrequencyData(data);
        const bars: number[] = [];
        const step = Math.max(1, Math.floor(data.length / 18));
        let peak = 0;
        for (let i = 0; i < 18; i++) {
          const v = (data[i * step] || 0) / 255;
          bars.push(Math.max(0.08, Math.min(1, v * 1.35)));
          peak = Math.max(peak, v);
        }
        setHzBars(bars);
        setMicLevel(peak);
        hzRafRef.current = requestAnimationFrame(tick);
      };
      hzRafRef.current = requestAnimationFrame(tick);
    } catch {
      /* mic permission denied — listening still via SpeechRecognition */
    }
  }, []);

  const stopAlwaysListen = useCallback(() => {
    try {
      alwaysListenRef.current?.stop();
    } catch {
      /* ignore */
    }
    alwaysListenRef.current = null;
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!soundEnabledRef.current) return;
      const clean = cleanBoardText(text) || text.trim();
      if (!clean) return;

      stopAlwaysListen();
      stopVoice();
      voiceBusy = true;
      const lang = selectedSpeechLanguage(locale || lesson.language);
      let teacherWave: number | null = null;
      teacherWave = window.setInterval(() => {
        const t = Date.now() / 95;
        setHzBars((prev) =>
          prev.map((_, i) => {
            const wave = Math.sin(t + i * 0.62) * 0.5 + 0.5;
            const pulse = Math.sin(t * 1.7 + i * 0.2) * 0.5 + 0.5;
            return Math.min(1, 0.18 + wave * 0.55 + pulse * 0.27);
          })
        );
      }, 45);
      try {
        const cloud = await fetchCloudSpeech(clean, lang);
        if (!cloud) {
          setVoiceError("missing");
          return;
        }
        if (cloud.speechLocale) {
          speechLocaleRef.current = cloud.speechLocale;
          setSpeechLocale(cloud.speechLocale);
        }
        setVoiceError(null);
        const blob = base64ToBlob(cloud.dataBase64, cloud.mimeType);
        const url = URL.createObjectURL(blob);
        activeCloudObjectUrl = url;
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audio.preload = "auto";
          audio.volume = 1;
          activeCloudAudio = audio;
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (activeCloudAudio === audio) activeCloudAudio = null;
            if (activeCloudObjectUrl === url) {
              try {
                URL.revokeObjectURL(url);
              } catch {
                /* ignore */
              }
              activeCloudObjectUrl = null;
            }
            resolve();
          };
          const safety = window.setTimeout(
            finish,
            (cloud.durationMs || estimateSpeakMs(clean)) + 5000
          );
          audio.onended = () => {
            window.clearTimeout(safety);
            finish();
          };
          audio.onerror = () => {
            window.clearTimeout(safety);
            finish();
          };
          void audio.play().catch(() => {
            window.clearTimeout(safety);
            finish();
          });
        });
      } finally {
        if (teacherWave != null) window.clearInterval(teacherWave);
        voiceBusy = false;
        if (
          handsFreeRef.current &&
          !handlingInterruptRef.current &&
          !cancelledRef.current
        ) {
          window.setTimeout(() => startAlwaysListenRef.current(), 320);
        }
      }
    },
    [lesson.language, locale, stopVoice, stopAlwaysListen]
  );

  const setBoardSmooth = useCallback((items: BoardItem[]) => {
    boardItemsRef.current = items;
    setBoard(items);
  }, []);

  const appendInterruptBoard = useCallback(
    (
      cues: Array<{
        time?: number;
        action: string;
        parameters?: Record<string, unknown>;
      }>
    ) => {
      if (!cues.length) return;
      const rtl = isRtlLang(lesson.language || locale);
      let acc = boardItemsRef.current;
      let penAt = nowMs();
      for (const item of acc) {
        if (item.kind === "text") penAt = Math.max(penAt, item.bornAt + item.writeMs + 200);
      }
      cues.slice(0, 5).forEach((cue, i) => {
        const action = String(cue.action || "").toLowerCase();
        const isText =
          action === "write_text" ||
          action === "draw_formula" ||
          action === "draw_equation";
        const start = isText ? penAt + i * 40 : nowMs() + i * 80;
        const before = acc.length;
        acc = applyCue(
          acc,
          {
            time: Number(cue.time) || i * 400,
            action: cue.action,
            parameters: cue.parameters || {},
          },
          boardAppliedRef.current + i + 1,
          start,
          rtl
        );
        if (isText && acc.length > before) {
          const last = acc[acc.length - 1];
          if (last?.kind === "text") penAt = last.bornAt + last.writeMs + 220;
        }
      });
      boardAppliedRef.current += cues.length;
      setBoardSmooth(acc);
    },
    [lesson.language, locale, setBoardSmooth]
  );

  /** Append cues with pen timing so only one write_text line animates at a time. */
  const applyBoardUntil = useCallback(
    (untilMs: number) => {
      let next = boardAppliedRef.current;
      const born = nowMs();
      let acc = boardItemsRef.current;
      let changed = false;
      const rtl = isRtlLang(lesson.language || locale);
      let penAt = born;
      while (next < whiteboard.length && whiteboard[next]!.time <= untilMs) {
        const cue = whiteboard[next]!;
        const action = String(cue.action || "").toLowerCase();
        const isText =
          action === "write_text" ||
          action === "draw_formula" ||
          action === "draw_equation";
        const start = isText ? penAt : born + (next - boardAppliedRef.current) * 40;
        const before = acc.length;
        acc = applyCue(acc, cue, next, start, rtl);
        if (isText && acc.length > before) {
          const last = acc[acc.length - 1];
          if (last?.kind === "text") {
            penAt = last.bornAt + last.writeMs + 280;
          }
        }
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

        const useVoice = soundEnabledRef.current;
        // Speak ASAP (especially first cue) so it stays tied to the tap gesture.
        const speakPromise = useVoice ? speak(cue.text) : Promise.resolve();

        await waitWhilePaused();
        if (runId !== runIdRef.current || cancelledRef.current) {
          stopVoice();
          return;
        }

        const start = nowMs();
        const maxWait = estimateSpeakMs(cue.text) + 8000;

        while (nowMs() - start < maxWait) {
          if (runId !== runIdRef.current || cancelledRef.current) {
            stopVoice();
            return;
          }
          await waitWhilePaused();
          if (pausedRef.current) continue;

          const elapsed = nowMs() - start;
          const span = Math.max(1400, nextTime - cue.time);
          applyBoardUntil(cue.time + Math.min(span, elapsed + 700));

          if (useVoice) {
            const speaking =
              voiceBusy || Boolean(activeCloudAudio && !activeCloudAudio.paused);
            if (!speaking && elapsed > 1600) break;
          } else if (elapsed >= Math.min(span, estimateSpeakMs(cue.text))) {
            break;
          }
          await new Promise((r) => setTimeout(r, 32));
        }

        await speakPromise;
        applyBoardUntil(nextTime);
        // Finish any in-flight handwriting so text is never cut mid-word.
        for (let w = 0; w < 100; w++) {
          const unfinished = boardItemsRef.current.some(
            (it) => progressOf(it, nowMs()) < 0.995
          );
          if (!unfinished) break;
          await new Promise((r) => setTimeout(r, 40));
        }
        // Natural classroom pause so the student can jump in.
        if (!pausedRef.current && runId === runIdRef.current) {
          await new Promise((r) => setTimeout(r, 550));
        }
      }

      if (runId !== runIdRef.current || cancelledRef.current) return;
      applyBoardUntil(Number.POSITIVE_INFINITY);
      setPhase("completed");
      setCaption(labels.completed);
      if (soundEnabledRef.current) {
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
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const profile = await fetchVoiceProfile(locale || lesson.language || "en");
      if (cancelled || !profile) return;
      speechLocaleRef.current = profile.speechLocale;
      setSpeechLocale(profile.speechLocale);
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, lesson.language]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      runIdRef.current += 1;
      stopVoice();
      stopAlwaysListen();
      stopHzMonitor();
      recognitionRef.current?.stop();
    };
  }, [stopVoice, stopAlwaysListen, stopHzMonitor]);

  function startAlwaysListen() {
    if (!handsFreeRef.current) return;
    if (handlingInterruptRef.current || voiceBusy) return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    stopAlwaysListen();
    try {
      const rec = new Ctor();
      rec.lang = speechLang(
        locale || lesson.language,
        speechLocaleRef.current || speechLocale
      );
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (ev) => {
        if (handlingInterruptRef.current || voiceBusy) return;
        let interim = "";
        let finalText = "";
        for (let i = 0; i < ev.results.length; i++) {
          const row = ev.results[i];
          const alt = row?.[0]?.transcript || "";
          if (row?.isFinal) finalText += `${alt} `;
          else interim += alt;
        }
        interimBufRef.current = (finalText || interim).trim();
        const words = interimBufRef.current.split(/\s+/).filter(Boolean);
        // Student started talking — pause teacher immediately (ChatGPT-like barge-in).
        if (words.length >= 2 && phaseRef.current === "teaching") {
          pauseTeaching();
          setPhase("listening");
        }
        const q = finalText.trim();
        if (q.split(/\s+/).filter(Boolean).length >= 2) {
          interimBufRef.current = "";
          void submitQuestionWithText(q);
        }
      };
      rec.onerror = () => {
        /* keep teaching; retry shortly */
        window.setTimeout(() => {
          if (handsFreeRef.current && !handlingInterruptRef.current) startAlwaysListen();
        }, 700);
      };
      rec.onend = () => {
        const p = phaseRef.current;
        if (
          handsFreeRef.current &&
          !handlingInterruptRef.current &&
          !cancelledRef.current &&
          (p === "teaching" || p === "listening" || p === "paused")
        ) {
          window.setTimeout(() => startAlwaysListen(), 280);
        }
      };
      alwaysListenRef.current = rec;
      recognitionRef.current = rec;
      rec.start();
    } catch {
      /* unsupported */
    }
  }
  startAlwaysListenRef.current = startAlwaysListen;

  function startWithVoice() {
    unlockVoice();
    handsFreeRef.current = true;
    setHandsFree(true);
    void startHzMonitor();
    // Mic starts after each TTS finishes (see speak) — avoids audio conflicts.
    void runLesson(0);
  }

  function pauseTeaching() {
    pausedRef.current = true;
    stopVoice();
    stopAlwaysListen();
    setPhase("paused");
  }

  function resumeTeaching() {
    setTeacherReply(null);
    pausedRef.current = false;
    setPhase("teaching");
    const next = Math.min(speechIdxRef.current + 1, Math.max(0, speech.length - 1));
    void runLesson(next);
  }

  function startListening() {
    // Manual mic is optional — same hands-free path.
    handsFreeRef.current = true;
    setHandsFree(true);
    void startHzMonitor();
    pauseTeaching();
    setPhase("listening");
    startAlwaysListen();
  }

  async function submitQuestionWithText(qRaw: string) {
    const q = cleanBoardText(qRaw) || qRaw.trim();
    if (!q || asking || handlingInterruptRef.current) return;
    handlingInterruptRef.current = true;
    stopAlwaysListen();
    stopVoice();
    setAsking(true);
    setPhase("answering");
    pauseTeaching();
    try {
      const spokenSoFar = speech.slice(0, speechIdxRef.current + 1).map((s) => s.text);
      let reply = labels.completed;
      let boardCues: Array<{
        time?: number;
        action: string;
        parameters?: Record<string, unknown>;
      }> = [];
      if (onAskTeacher) {
        const raw = await onAskTeacher({
          question: q,
          pausedSpeechIndex: speechIdxRef.current,
          spokenSoFar,
          lessonTitle: lesson.lesson_title,
          documentIds: lesson.documentIds,
          curriculumOutline: lesson.curriculumOutline,
          materialNames: lesson.materialNames,
        });
        if (typeof raw === "string") {
          reply = raw;
        } else {
          reply = raw.answer || labels.completed;
          boardCues = raw.board || [];
        }
      }
      const cleanReply = cleanBoardText(reply) || reply;
      setTeacherReply(cleanReply);
      setCaption(cleanReply);
      appendInterruptBoard(boardCues);
      if (soundEnabledRef.current) await speak(cleanReply);
    } finally {
      setAsking(false);
      setPhase("paused");
      handlingInterruptRef.current = false;
      // Give the student a beat to absorb / reply, then continue teaching.
      window.setTimeout(() => {
        if (!cancelledRef.current) resumeTeaching();
      }, 1400);
    }
  }

  const uiLocale = normalizeUiLocale(locale);
  const dir = uiLocale === "ar" ? "rtl" : "ltr";
  const boardRtl = isRtlLang(lesson.language || locale);

  const isWriting = board.some((b) => progressOf(b, clock) < 1) && phase === "teaching";
  const progressPct = speech.length
    ? Math.round(((Math.min(speechIndex + 1, speech.length)) / speech.length) * 100)
    : 0;

  const phaseLabel =
    phase === "teaching"
      ? labels.phaseTeaching
      : phase === "paused"
        ? labels.phasePaused
        : phase === "listening"
          ? labels.phaseListening
          : phase === "answering"
            ? labels.phaseAnswering
            : phase === "completed"
              ? labels.phaseCompleted
              : labels.phaseReady;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 bg-[linear-gradient(165deg,#0b1220_0%,#111827_42%,#0a1628_100%)] text-slate-100 sm:rounded-[28px] sm:border sm:border-white/10 sm:shadow-[0_40px_100px_-40px_rgba(0,0,0,0.75)]"
      dir={dir}
    >
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 start-1/4 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 end-0 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl"
      />

      {/* Top bar */}
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3 border-b border-white/8 px-4 py-3.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300/90">
              U Learn · {labels.classroom}
            </p>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold text-slate-200">
              {phaseLabel}
            </span>
          </div>
          <h4 className="mt-1 truncate text-lg font-semibold leading-tight tracking-tight text-white sm:text-xl">
            {cleanBoardText(lesson.lesson_title) || lesson.lesson_title}
          </h4>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-1.5 sm:w-40">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span>{labels.progress}</span>
            <span>
              {speech.length
                ? `${Math.min(speechIndex + 1, speech.length)}/${speech.length}`
                : "0/0"}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-[width] duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Board stage — fills remaining viewport */}
      <div className="relative z-10 mx-2 mt-2 min-h-0 flex-1 overflow-hidden rounded-[18px] border border-white/10 bg-[#f7fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_20px_50px_-30px_rgba(0,0,0,0.55)] sm:mx-4 sm:mt-3 sm:rounded-[22px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-slate-900/10 to-transparent" />
        <svg
          viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
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
              const chars =
                p >= 0.995
                  ? item.text.length
                  : Math.max(1, Math.ceil(item.text.length * p));
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
                    <tspan fill="#0ea5e9" fontWeight={700}>
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

        {phase === "ready" ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-b from-slate-950/50 via-slate-950/35 to-slate-900/55 backdrop-blur-[2px] transition-opacity">
            <button
              type="button"
              onClick={() => startWithVoice()}
              className="group mx-4 flex max-w-md flex-col items-center gap-3 rounded-[28px] border border-white/15 bg-slate-950/90 px-8 py-8 text-center shadow-[0_30px_80px_-20px_rgba(14,165,233,0.45)] transition duration-300 hover:scale-[1.02] hover:border-sky-300/40"
            >
              <span className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-emerald-400 text-slate-950 shadow-lg shadow-sky-400/30 transition group-hover:scale-105">
                <svg
                  viewBox="0 0 24 24"
                  className="ms-0.5 h-9 w-9 fill-current"
                  aria-hidden
                >
                  <path d="M8 5.14v13.72L19 12 8 5.14z" />
                </svg>
              </span>
              <span className="text-xl font-bold tracking-tight text-white">
                {labels.tapToBegin}
              </span>
              <span className="text-sm text-slate-300">{labels.tapHint}</span>
              <span className="text-[11px] font-medium text-slate-500">
                {labels.interruptHint}
              </span>
            </button>
          </div>
        ) : null}

        {(phase === "listening" || phase === "answering") ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
            <div className="rounded-full border border-white/15 bg-slate-950/80 px-3 py-1 text-[11px] font-semibold text-amber-200 backdrop-blur-md">
              {phase === "listening" ? labels.listening : labels.teacherReply}
            </div>
          </div>
        ) : null}

        {/* Live caption overlay on the board */}
        {phase !== "ready" ? (
          <div className="absolute inset-x-3 bottom-3 z-10 rounded-2xl border border-white/15 bg-slate-950/80 px-3.5 py-2.5 backdrop-blur-md sm:inset-x-4">
            <div className="flex items-center gap-2">
              {soundEnabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  {labels.liveVoice}
                </span>
              ) : null}
              {isWriting ? (
                <span className="text-[10px] font-semibold text-sky-300">{labels.writing}</span>
              ) : null}
            </div>
            <p key={caption} className="mt-1 text-[15px] font-medium leading-snug text-white sm:text-base">
              {cleanBoardText(caption) || "…"}
            </p>
            {teacherReply ? (
              <p className="mt-1.5 text-sm text-sky-200">{teacherReply}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Slim professional voice interaction line */}
      <div className="relative z-10 mx-3 mt-2 mb-2 flex items-center gap-2 sm:mx-4">
        {phase === "ready" || phase === "completed" ? (
          <button
            type="button"
            className="shrink-0 rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 px-3.5 py-1.5 text-xs font-bold text-slate-950"
            onClick={() => startWithVoice()}
          >
            {labels.start}
          </button>
        ) : null}
        {phase === "teaching" ? (
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5"
            onClick={pauseTeaching}
            aria-label={labels.pause}
            title={labels.pause}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
              <path d="M8 5h3v14H8V5zm5 0h3v14h-3V5z" />
            </svg>
          </button>
        ) : null}
        {phase === "paused" || phase === "answering" ? (
          <button
            type="button"
            className="shrink-0 rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 px-3 py-1.5 text-[11px] font-bold text-slate-950"
            onClick={resumeTeaching}
          >
            {teacherReply ? labels.continue : labels.resume}
          </button>
        ) : null}
        <button
          type="button"
          className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 transition hover:border-white/20"
          onClick={() => {
            if (phase === "ready" || phase === "completed") {
              startWithVoice();
              return;
            }
            if (handsFree) {
              handsFreeRef.current = false;
              setHandsFree(false);
              stopAlwaysListen();
            } else {
              startListening();
            }
          }}
          aria-label={handsFree ? labels.listening : labels.ask}
          title={handsFree ? labels.listening : labels.ask}
        >
          <div className="flex h-4 flex-1 items-center gap-[2px]" aria-hidden>
            {hzBars.map((h, i) => (
              <span
                key={i}
                className={cn(
                  "min-w-[1.5px] flex-1 rounded-full transition-[height,background-color] duration-75",
                  phase === "listening" || micLevel > 0.18
                    ? "bg-amber-300/90"
                    : phase === "teaching" || phase === "answering"
                      ? "bg-emerald-300/90"
                      : "bg-sky-300/55"
                )}
                style={{ height: `${Math.max(2, Math.round(h * 14))}px` }}
              />
            ))}
          </div>
          <span className="max-w-[38%] truncate text-[10px] font-medium tracking-wide text-white/55">
            {phase === "listening"
              ? labels.listening
              : phase === "answering"
                ? labels.teacherReply
                : phase === "teaching"
                  ? labels.liveVoice
                  : labels.ask}
          </span>
        </button>
      </div>
      {voiceError ? (
        <p className="relative z-10 mx-4 mb-2 text-center text-[11px] font-semibold text-rose-300">
          {labels.voiceMissing}
        </p>
      ) : null}
      {phase === "completed" && lesson.summary?.length > 0 && (
        <div className="relative z-10 mx-3 mb-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 sm:mx-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            {labels.summary}
          </p>
          <ul className="mt-2 list-disc space-y-1.5 ps-4 text-sm text-slate-200">
            {lesson.summary.map((s, i) => (
              <li key={i}>{cleanBoardText(s) || s}</li>
            ))}
          </ul>
        </div>
      )}

      {phase === "completed" && lesson.quiz?.length > 0 && (
        <div className="relative z-10 mx-3 mb-4 space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 sm:mx-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            {labels.quiz}
          </p>
          {lesson.quiz.map((q, qi) => (
            <div
              key={qi}
              className="rounded-2xl border border-white/10 bg-slate-950/40 p-3"
            >
              <p className="text-sm font-medium">
                {qi + 1}. {q.question}
              </p>
              {q.choices?.length > 0 && (
                <ul className="mt-1.5 space-y-1 text-sm text-slate-300">
                  {q.choices.map((c, ci) => (
                    <li key={ci}>
                      {String.fromCharCode(65 + ci)}. {c}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-sky-300 hover:underline"
                onClick={() =>
                  setQuizReveal((prev) => ({ ...prev, [qi]: !prev[qi] }))
                }
              >
                {quizReveal[qi] ? labels.hideAnswer : labels.showAnswer}
              </button>
              {quizReveal[qi] ? (
                <p className="mt-1.5 text-sm text-emerald-200">{q.answer}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
