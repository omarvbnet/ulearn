"use client";

import { Button, Card } from "@/components/ui";
import { EmptyState, ProgressBar, SkeletonRows } from "@/components/overlay";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Question = {
  id: string;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE";
  textEn: string;
  options: Record<string, string> | { key: string; label: string }[];
  points: number;
};

type Quiz = {
  id: string;
  titleEn: string;
  timeLimitSec?: number | null;
  maxAttempts: number;
  attemptsUsed: number;
  passPercentage: number;
  questions: Question[];
};

type Attempt = {
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
};

export function QuizClient({ quizId, locale }: { quizId: string; locale: string }) {
  const t = useT();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [result, setResult] = useState<Attempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    fetch(`/api/quizzes/${quizId}`).then(async (res) => {
      if (res.ok) {
        setQuiz((await res.json()).quiz);
      } else {
        const err = await res.json().catch(() => null);
        setErrorMsg(err?.error ?? "Quiz unavailable");
      }
    });
  }, [quizId]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    const res = await fetch(`/api/quizzes/${quizId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers,
        timeSpentSec: Math.floor((Date.now() - startedAt.current) / 1000),
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      setResult((await res.json()).attempt);
    } else {
      const err = await res.json().catch(() => null);
      setErrorMsg(err?.error ?? "Failed to submit");
    }
  }, [quizId, answers, submitting]);

  // Countdown timer
  useEffect(() => {
    if (!started || timeLeft === null || result) return;
    if (timeLeft <= 0) {
      submit();
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [started, timeLeft, result, submit]);

  function start() {
    setStarted(true);
    startedAt.current = Date.now();
    if (quiz?.timeLimitSec) setTimeLeft(quiz.timeLimitSec);
  }

  if (errorMsg) {
    return (
      <Card className="animate-scale-in mx-auto max-w-md py-12 text-center">
        <p className="font-medium text-danger">{errorMsg}</p>
        <Link href={`/${locale}/student/courses`}>
          <Button variant="outline" className="mt-6">{t.quiz.backToCourses}</Button>
        </Link>
      </Card>
    );
  }

  if (!quiz) return <SkeletonRows rows={5} />;

  /* ── Result screen ── */
  if (result) {
    return (
      <Card className="animate-scale-in mx-auto max-w-lg py-10 text-center">
        <div className={cn("animate-glow-pulse mx-auto flex h-28 w-28 items-center justify-center rounded-full text-3xl font-bold",
          result.passed ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>
          {Math.round(result.percentage)}%
        </div>
        <h2 className="mt-6 text-2xl font-bold">
          {result.passed ? t.quiz.passed : t.quiz.failed}
        </h2>
        <p className="mt-2 text-muted">
          {result.score} / {result.maxScore} {t.quiz.points} · {t.quiz.passMark} {quiz.passPercentage}%
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href={`/${locale}/student/courses`}>
            <Button variant="outline">{t.quiz.backToCourses}</Button>
          </Link>
          {!result.passed && quiz.attemptsUsed + 1 < quiz.maxAttempts && (
            <Button onClick={() => location.reload()}>{t.quiz.tryAgain}</Button>
          )}
        </div>
      </Card>
    );
  }

  /* ── Intro screen ── */
  if (!started) {
    return (
      <Card className="animate-slide-up mx-auto max-w-lg py-10 text-center">
        <h1 className="text-2xl font-bold glow-text">{quiz.titleEn}</h1>
        <div className="mx-auto mt-6 grid max-w-xs grid-cols-3 gap-3 text-center">
          <div className="stat-card !p-3">
            <p className="text-lg font-bold">{quiz.questions.length}</p>
            <p className="text-xs text-muted">{t.quiz.questions}</p>
          </div>
          <div className="stat-card !p-3">
            <p className="text-lg font-bold">
              {quiz.timeLimitSec ? `${Math.round(quiz.timeLimitSec / 60)}m` : "∞"}
            </p>
            <p className="text-xs text-muted">{t.quiz.time}</p>
          </div>
          <div className="stat-card !p-3">
            <p className="text-lg font-bold">
              {quiz.maxAttempts - quiz.attemptsUsed}
            </p>
            <p className="text-xs text-muted">{t.quiz.attemptsLeft}</p>
          </div>
        </div>
        <Button onClick={start} className="mt-8">{t.quiz.startQuiz}</Button>
      </Card>
    );
  }

  /* ── Question screen ── */
  const q = quiz.questions[current];
  const options = normalizeOptions(q);
  const answered = Object.keys(answers).length;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <ProgressBar value={((current + 1) / quiz.questions.length) * 100} />
        </div>
        {timeLeft !== null && (
          <span className={cn(
            "rounded-lg px-3 py-1 font-mono text-sm font-bold",
            timeLeft <= 30 ? "animate-glow-pulse bg-danger/15 text-danger" : "bg-card text-accent"
          )}>
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
          </span>
        )}
      </div>

      <Card key={q.id} className="animate-slide-up">
        <p className="text-sm text-muted">
          {t.quiz.question} {current + 1} {t.quiz.of} {quiz.questions.length} · {q.points} {t.quiz.pt}
        </p>
        <h2 className="mt-2 text-lg font-semibold">{q.textEn}</h2>

        <div className="mt-6 space-y-3">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setAnswers({ ...answers, [q.id]: opt.key })}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border p-4 text-start text-sm transition-all duration-200",
                answers[q.id] === opt.key
                  ? "border-accent bg-accent/10 text-foreground shadow-[0_0_20px_rgba(0,229,255,0.15)]"
                  : "border-card-border hover:border-accent/40"
              )}
            >
              <span className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition",
                answers[q.id] === opt.key ? "border-accent bg-accent text-black" : "border-card-border text-muted"
              )}>
                {opt.key.toUpperCase()}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>
          {t.quiz.previous}
        </Button>
        <span className="text-sm text-muted">{answered}/{quiz.questions.length} {t.quiz.answeredCount}</span>
        {current < quiz.questions.length - 1 ? (
          <Button onClick={() => setCurrent((c) => c + 1)}>{t.quiz.next}</Button>
        ) : (
          <Button onClick={submit} disabled={submitting}>
            {submitting ? t.quiz.submitting : t.quiz.submit}
          </Button>
        )}
      </div>
    </div>
  );
}

function normalizeOptions(q: Question): { key: string; label: string }[] {
  if (q.type === "TRUE_FALSE") {
    return [
      { key: "true", label: "True" },
      { key: "false", label: "False" },
    ];
  }
  if (Array.isArray(q.options)) return q.options;
  return Object.entries(q.options ?? {}).map(([key, label]) => ({
    key,
    label: String(label),
  }));
}
