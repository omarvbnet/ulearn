"use client";

import { Badge, Button, Card, Textarea } from "@/components/ui";
import { EmptyState, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Question = {
  id: string;
  body: string;
  isResolved: boolean;
  createdAt: string;
  student: { fullLegalName: string };
  lesson: {
    nameEn: string;
    chapter: { subject: { nameEn: string } };
  };
  answers: {
    id: string;
    body: string;
    createdAt: string;
    teacher: { fullLegalName: string };
  }[];
};

export function QuestionsClient() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("open");
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setQuestions(null);
    const res = await fetch(`/api/teacher/questions?filter=${filter}`);
    if (res.ok) setQuestions((await res.json()).questions);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendAnswer(questionId: string, resolve: boolean) {
    setSending(true);
    const res = await fetch(`/api/questions/${questionId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: reply, resolve }),
    });
    setSending(false);
    if (res.ok) {
      toast(resolve ? "Answered and resolved" : "Answer posted");
      setReply("");
      setReplying(null);
      load();
    } else {
      toast("Failed to post answer", "error");
    }
  }

  return (
    <div className="space-y-5">
      <Tabs
        tabs={[
          { id: "open", label: "Open" },
          { id: "resolved", label: "Resolved" },
          { id: "all", label: "All" },
        ]}
        active={filter}
        onChange={setFilter}
      />

      {questions === null ? (
        <SkeletonRows rows={5} />
      ) : questions.length === 0 ? (
        <EmptyState
          title={filter === "open" ? "No open questions" : "Nothing here"}
          hint={filter === "open" ? "New student questions will appear here." : undefined}
        />
      ) : (
        <div className="stagger space-y-4">
          {questions.map((q) => (
            <Card key={q.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{q.student.fullLegalName}</p>
                  <p className="text-xs text-muted">
                    {q.lesson.chapter.subject.nameEn} · {q.lesson.nameEn} ·{" "}
                    {new Date(q.createdAt).toLocaleString()}
                  </p>
                </div>
                <Badge status={q.isResolved ? "APPROVED" : "PENDING"}>
                  {q.isResolved ? "Resolved" : "Open"}
                </Badge>
              </div>

              <p className="mt-3">{q.body}</p>

              {q.answers.map((a) => (
                <div key={a.id} className="mt-3 rounded-lg border-s-2 border-accent/60 bg-accent/5 p-3">
                  <p className="text-xs font-semibold text-accent">{a.teacher.fullLegalName}</p>
                  <p className="mt-1 text-sm">{a.body}</p>
                </div>
              ))}

              {replying === q.id ? (
                <div className="animate-slide-down mt-4 space-y-3">
                  <Textarea
                    placeholder="Write your answer…"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    autoFocus
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={sending || !reply.trim()} onClick={() => sendAnswer(q.id, true)}>
                      Answer & Resolve
                    </Button>
                    <Button variant="outline" disabled={sending || !reply.trim()} onClick={() => sendAnswer(q.id, false)}>
                      Answer Only
                    </Button>
                    <Button variant="ghost" onClick={() => { setReplying(null); setReply(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" className="mt-4" onClick={() => setReplying(q.id)}>
                  Reply
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
