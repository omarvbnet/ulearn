"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  exam?: PracticeExam | null;
  examDone?: boolean;
  result?: ExamResult | null;
};

type PracticeExam = {
  examAttemptId: string;
  title: string;
  timeLimitSec: number;
  questions: Array<{ text: string; options: Record<string, string> }>;
};

type ExamResult = {
  percentage: number;
  passed: boolean;
  score: number;
  maxScore: number;
  analysis?: string;
  review?: Array<{ text: string; isCorrect: boolean }>;
};

type KbDoc = { id: string; fileName: string };
type Conv = { id: string; title?: string | null; updatedAt?: string };

export default function StudentAiPage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [examCount, setExamCount] = useState<5 | 10 | 20>(5);
  const endRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/ai/conversations");
    if (!res.ok) return;
    const data = await res.json();
    setConversations(data.conversations || []);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function sendChat(question?: string) {
    const q = (question ?? input).trim();
    if (!q || sending) return;
    setSending(true);
    setInput("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: q }]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          language: locale,
          conversationId: conversationId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat failed");
      setConversationId(data.conversationId || conversationId);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", text: data.answer || "" },
      ]);
      void loadHistory();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : "Chat failed",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function openConversation(id: string) {
    setSending(true);
    try {
      const res = await fetch(`/api/ai/conversations/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setConversationId(id);
      const msgs = (data.conversation?.messages || []) as Array<{
        id: string;
        role: string;
        content: string;
        citations?: {
          practiceQuiz?: PracticeExam;
          review?: Array<{ text: string; isCorrect: boolean }>;
        };
      }>;
      setMessages(
        msgs.map((m) => {
          const practice = m.citations?.practiceQuiz;
          const hasReview = Array.isArray(m.citations?.review);
          return {
            id: m.id,
            role: m.role === "USER" ? "user" : "assistant",
            text: m.content,
            exam: practice || null,
            examDone: Boolean(practice),
            result: hasReview
              ? {
                  percentage: 0,
                  passed: false,
                  score: 0,
                  maxScore: (m.citations?.review || []).length,
                  analysis: m.content,
                  review: m.citations?.review,
                }
              : null,
          };
        })
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSending(false);
    }
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setInput("");
  }

  async function openExamPicker() {
    const res = await fetch("/api/ai/kb-documents");
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || t.student.aiNoMaterials);
      return;
    }
    const list = (data.documents || []) as KbDoc[];
    if (!list.length) {
      const pending = Number(data.meta?.pendingForStage || 0);
      const insights = data.meta?.scope === "insights";
      const emptyMsg =
        pending > 0
          ? insights
            ? t.student.aiMaterialsProcessingInsights
            : t.student.aiMaterialsProcessingStage
          : insights
            ? t.student.aiNoMaterialsInsights
            : t.student.aiNoMaterialsStage;
      alert(emptyMsg || t.student.aiNoMaterials);
      return;
    }
    setDocs(list);
    setSelectedDocs([]);
    setExamCount(5);
    setPickerOpen(true);
  }

  async function generateExam() {
    if (!selectedDocs.length) return;
    setPickerOpen(false);
    setSending(true);
    const prompt = "Generate a practice exam from my selected materials";
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: prompt }]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prompt,
          language: locale,
          mode: "practice_quiz",
          documentIds: selectedDocs,
          count: examCount,
          conversationId: conversationId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Exam failed");
      setConversationId(data.conversationId || conversationId);
      const practice = data.practiceQuiz as PracticeExam | undefined;
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.answer || "",
          exam: practice
            ? {
                ...practice,
                examAttemptId: practice.examAttemptId || data.examAttemptId,
              }
            : null,
        },
      ]);
      void loadHistory();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : "Exam failed",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function submitExam(
    msgId: string,
    exam: PracticeExam,
    answers: Record<string, string>,
    elapsedSec: number,
    expired: boolean
  ) {
    const res = await fetch("/api/ai/exams/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examAttemptId: exam.examAttemptId,
        answers,
        elapsedSec,
        expired,
        language: locale,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Submit failed");
    setMessages((m) => [
      ...m.map((x) => (x.id === msgId ? { ...x, examDone: true } : x)),
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: "",
        result: data as ExamResult,
      },
    ]);
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-4 lg:flex-row">
      <aside className="w-full shrink-0 rounded-2xl border border-border bg-card p-3 lg:w-64">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t.student.aiHistory}</h2>
          <Button type="button" variant="outline" onClick={newChat}>
            {t.student.aiNewChat}
          </Button>
        </div>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto lg:max-h-[70vh]">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => openConversation(c.id)}
              className={cn(
                "w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/5",
                conversationId === c.id && "bg-accent/15 text-accent"
              )}
            >
              {c.title?.trim() || "Chat"}
            </button>
          ))}
          {!conversations.length && (
            <p className="px-2 py-6 text-center text-sm text-muted">{t.student.aiEmpty}</p>
          )}
        </div>
      </aside>

      <div className="flex min-h-[60vh] flex-1 flex-col rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <PageHeader title={t.student.aiPageTitle} description={t.student.aiPageHint} />
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!messages.length && (
            <Card className="border-dashed text-center text-muted">{t.student.aiEmpty}</Card>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div className="max-w-[92%] space-y-2">
                {m.text ? (
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-accent/20 text-foreground"
                        : "bg-white/5 text-foreground"
                    )}
                  >
                    {m.text}
                  </div>
                ) : null}
                {m.exam ? (
                  <ExamPanel
                    exam={m.exam}
                    disabled={Boolean(m.examDone)}
                    submitLabel={t.student.aiSubmitExam}
                    onSubmit={(answers, elapsed, expired) =>
                      submitExam(m.id, m.exam!, answers, elapsed, expired)
                    }
                  />
                ) : null}
                {m.result ? <ResultPanel result={m.result} /> : null}
              </div>
            </div>
          ))}
          {sending && <p className="text-sm text-muted">{t.student.aiThinking}</p>}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border p-3">
          <div className="mb-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={openExamPicker} disabled={sending}>
              {t.student.aiGenerateExam}
            </Button>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendChat();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.student.aiPlaceholder}
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <Button type="submit" disabled={sending || !input.trim()}>
              {t.student.aiSend}
            </Button>
          </form>
        </div>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="max-h-[80vh] w-full max-w-lg overflow-hidden p-0">
            <div className="border-b border-border p-4">
              <h3 className="font-semibold">{t.student.aiPickMaterials}</h3>
              <p className="mt-1 text-sm text-muted">{t.student.aiPickMaterialsHint}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                {t.student.aiExamDifficulty}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    { count: 5 as const, label: t.student.aiExamBasic },
                    { count: 10 as const, label: t.student.aiExamIntermediate },
                    { count: 20 as const, label: t.student.aiExamAdvanced },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.count}
                    type="button"
                    onClick={() => setExamCount(opt.count)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm font-medium transition",
                      examCount === opt.count
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border text-muted hover:border-accent/40"
                    )}
                  >
                    {opt.label}
                    <span className="ms-1 text-xs opacity-80">({opt.count})</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[50vh] space-y-1 overflow-y-auto p-3">
              {docs.map((d) => {
                const checked = selectedDocs.includes(d.id);
                return (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedDocs((prev) =>
                          checked ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                        )
                      }
                    />
                    <span className="text-sm">{d.fileName}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-3">
              <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button
                type="button"
                disabled={!selectedDocs.length || sending}
                onClick={() => void generateExam()}
              >
                {t.student.aiGenerateExam}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function ExamPanel({
  exam,
  disabled,
  submitLabel,
  onSubmit,
}: {
  exam: PracticeExam;
  disabled: boolean;
  submitLabel: string;
  onSubmit: (answers: Record<string, string>, elapsed: number, expired: boolean) => Promise<void>;
}) {
  const [remaining, setRemaining] = useState(exam.timeLimitSec);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(disabled);
  const started = useRef(Date.now());
  const finishing = useRef(false);
  const answersRef = useRef(answers);
  const onSubmitRef = useRef(onSubmit);
  answersRef.current = answers;
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(id);
          if (!finishing.current) {
            finishing.current = true;
            void (async () => {
              setBusy(true);
              setDone(true);
              try {
                const elapsed = Math.floor((Date.now() - started.current) / 1000);
                await onSubmitRef.current(answersRef.current, elapsed, true);
              } finally {
                setBusy(false);
              }
            })();
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [done]);

  async function finish(expired: boolean) {
    if (busy || done || finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setDone(true);
    try {
      const elapsed = Math.floor((Date.now() - started.current) / 1000);
      await onSubmit(answers, elapsed, expired);
    } finally {
      setBusy(false);
    }
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="font-semibold">{exam.title}</h4>
        <span className={cn("rounded-full px-3 py-1 text-xs font-bold", remaining <= 30 && "text-red-400")}>
          {mm}:{ss}
        </span>
      </div>
      <div className="space-y-4">
        {exam.questions.map((q, i) => (
          <div key={i}>
            <p className="mb-2 text-sm font-medium">
              {i + 1}. {q.text}
            </p>
            <div className="space-y-1">
              {Object.entries(q.options || {}).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  disabled={done}
                  onClick={() => setAnswers((a) => ({ ...a, [String(i)]: k }))}
                  className={cn(
                    "block w-full rounded-xl border px-3 py-2 text-left text-sm",
                    answers[String(i)] === k
                      ? "border-accent bg-accent/15"
                      : "border-border hover:bg-white/5"
                  )}
                >
                  {k}. {v}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!done && (
        <Button className="mt-4 w-full" disabled={busy} onClick={() => void finish(false)}>
          {submitLabel}
        </Button>
      )}
    </div>
  );
}

function ResultPanel({ result }: { result: ExamResult }) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        result.passed ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="font-semibold">{result.passed ? "Passed" : "Needs review"}</p>
        <p className="text-2xl font-extrabold">{result.percentage}%</p>
      </div>
      <p className="mt-1 text-sm text-muted">
        Score {result.score}/{result.maxScore}
      </p>
      {result.analysis ? <p className="mt-3 text-sm leading-relaxed">{result.analysis}</p> : null}
      {result.review?.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {result.review.slice(0, 8).map((r, i) => (
            <li key={i} className="flex gap-2">
              <span>{r.isCorrect ? "✓" : "✗"}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
