"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type AiTeacherLessonView = {
  language?: string;
  lesson_title: string;
  objective?: string;
  speech: { time: number; text: string }[];
  whiteboard: { time: number; action: string; parameters: Record<string, unknown> }[];
  quiz: { question: string; choices: string[]; answer: string }[];
  summary: string[];
};

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Renders a structured AI Teacher whiteboard lesson for students. */
export function AiTeacherLessonCard({
  lesson,
  locale = "en",
}: {
  lesson: AiTeacherLessonView;
  locale?: string;
}) {
  const [quizReveal, setQuizReveal] = useState<Record<number, boolean>>({});
  const [speaking, setSpeaking] = useState(false);
  const autoSpokenRef = useRef(false);

  const labels = useMemo(() => {
    if (locale === "ar") {
      return {
        board: "السبورة",
        speech: "الشرح الصوتي",
        summary: "الملخص",
        quiz: "اختبار سريع",
        play: "استمع للدرس",
        stop: "إيقاف",
        showAnswer: "أظهر الإجابة",
        hideAnswer: "إخفاء الإجابة",
        actions: "إجراءات اللوحة",
        objective: "الهدف",
      };
    }
    if (locale === "tr") {
      return {
        board: "Tahta",
        speech: "Konuşma",
        summary: "Özet",
        quiz: "Mini quiz",
        play: "Dersi dinle",
        stop: "Durdur",
        showAnswer: "Cevabı göster",
        hideAnswer: "Cevabı gizle",
        actions: "Tahta hareketleri",
        objective: "Hedef",
      };
    }
    if (locale === "ku") {
      return {
        board: "تەختە",
        speech: "قسە",
        summary: "پوختە",
        quiz: "تاقیکردنەوەی کورت",
        play: "گوێ لە وانە بگرە",
        stop: "وەستان",
        showAnswer: "وەڵام پیشان بدە",
        hideAnswer: "وەڵام بشارەوە",
        actions: "کردارەکانی تەختە",
        objective: "ئامانج",
      };
    }
    return {
      board: "Whiteboard",
      speech: "Spoken lesson",
      summary: "Summary",
      quiz: "Mini quiz",
      play: "Listen to lesson",
      stop: "Stop",
      showAnswer: "Show answer",
      hideAnswer: "Hide answer",
      actions: "Board actions",
      objective: "Objective",
    };
  }, [locale]);

  function toggleSpeech() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utter = new SpeechSynthesisUtterance(
      lesson.speech.map((s) => s.text).join(". ")
    );
    utter.lang =
      lesson.language === "ar"
        ? "ar-SA"
        : lesson.language === "tr"
          ? "tr-TR"
          : lesson.language === "ku"
            ? "ku"
            : "en-US";
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }

  useEffect(() => {
    if (autoSpokenRef.current) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    autoSpokenRef.current = true;
    toggleSpeech();
    return () => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewActions = lesson.whiteboard.slice(0, 12);

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">
            U Learn AI Teacher
          </p>
          <h4 className="text-base font-semibold text-foreground">{lesson.lesson_title}</h4>
          {lesson.objective ? (
            <p className="mt-1 text-sm text-muted">
              <span className="font-medium text-foreground/80">{labels.objective}: </span>
              {lesson.objective}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={toggleSpeech}
          className="rounded-full border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/25"
        >
          {speaking ? labels.stop : labels.play}
        </button>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted">{labels.speech}</p>
        <ol className="max-h-40 space-y-1.5 overflow-y-auto text-sm">
          {lesson.speech.map((s, i) => (
            <li key={`${s.time}-${i}`} className="flex gap-2">
              <span className="shrink-0 font-mono text-[11px] text-violet-300/80">
                {formatMs(s.time)}
              </span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      </div>

      {previewActions.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted">
            {labels.board} · {labels.actions} ({lesson.whiteboard.length})
          </p>
          <ul className="max-h-28 space-y-1 overflow-y-auto text-xs text-muted">
            {previewActions.map((a, i) => (
              <li key={`${a.time}-${a.action}-${i}`} className="font-mono">
                {formatMs(a.time)} · {a.action}
                {typeof a.parameters.text === "string"
                  ? ` — “${String(a.parameters.text).slice(0, 60)}”`
                  : ""}
              </li>
            ))}
            {lesson.whiteboard.length > previewActions.length ? (
              <li>… +{lesson.whiteboard.length - previewActions.length}</li>
            ) : null}
          </ul>
        </div>
      )}

      {lesson.summary?.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted">{labels.summary}</p>
          <ul className="list-disc space-y-1 ps-4 text-sm">
            {lesson.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {lesson.quiz?.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-muted">{labels.quiz}</p>
          <ul className="space-y-3">
            {lesson.quiz.map((q, qi) => (
              <li key={qi} className="rounded-xl border border-card-border bg-card/40 p-2.5">
                <p className="text-sm font-medium">
                  {qi + 1}. {q.question}
                </p>
                {q.choices?.length > 0 && (
                  <ul className="mt-1.5 space-y-1 text-sm text-muted">
                    {q.choices.map((c, ci) => (
                      <li key={ci}>
                        {String.fromCharCode(65 + ci)}. {c}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className={cn(
                    "mt-2 text-xs font-semibold text-accent hover:underline"
                  )}
                  onClick={() =>
                    setQuizReveal((prev) => ({ ...prev, [qi]: !prev[qi] }))
                  }
                >
                  {quizReveal[qi] ? labels.hideAnswer : labels.showAnswer}
                </button>
                {quizReveal[qi] ? (
                  <p className="mt-1 text-sm text-accent">{q.answer}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
