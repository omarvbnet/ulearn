"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

type Tab = "library" | "chat" | "exams" | "generate" | "docai" | "bank" | "pdf" | "jobs";

type Doc = {
  id: string;
  fileName: string;
  status: string;
  chunkCount?: number;
  mimeType?: string | null;
};

type Job = {
  id: string;
  type: string;
  status: string;
  progress: number;
  errorMessage?: string | null;
  resultJson?: Record<string, unknown> | null;
};

type Course = { id: string; titleEn: string };

const DOC_ACTIONS = [
  "SUMMARIZE",
  "EXPLAIN",
  "CHAPTER_ANALYSIS",
  "EXTRACT_CONCEPTS",
  "FLASHCARDS",
  "MIND_MAP",
  "NOTES",
  "QUESTIONS",
  "ASSIGNMENT",
];

const PDF_TOOLS = [
  "MERGE",
  "SPLIT",
  "ROTATE",
  "WATERMARK",
  "PROTECT",
  "COMPRESS",
  "EXTRACT_TEXT",
  "COMPARE",
  "CONVERT_DOCX",
  "CONVERT_PPTX",
];

const GEN_TYPES = [
  "LECTURE",
  "NOTES",
  "STUDY_GUIDE",
  "TEACHING_MANUAL",
  "SYLLABUS",
  "LESSON_PLAN",
  "WEEKLY_PLAN",
  "SEMESTER_PLAN",
  "LEARNING_OUTCOMES",
  "PRESENTATION_OUTLINE",
] as const;

export default function TeacherAiStudioPage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const [tab, setTab] = useState<Tab>("library");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // chat
  const [question, setQuestion] = useState("");
  const [chatLog, setChatLog] = useState<Array<{ role: string; text: string }>>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // exams
  const [examTitle, setExamTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [examCount, setExamCount] = useState(8);

  // generate
  const [genType, setGenType] = useState<(typeof GEN_TYPES)[number]>("LECTURE");
  const [genTitle, setGenTitle] = useState("");
  const [genTopic, setGenTopic] = useState("");
  const [genPages, setGenPages] = useState(3);

  // bank
  const [bank, setBank] = useState<Array<Record<string, unknown>>>([]);
  const [bankQ, setBankQ] = useState("");

  // grade
  const [gradeQ, setGradeQ] = useState("");
  const [gradeA, setGradeA] = useState("");

  // pdf
  const [pdfTool, setPdfTool] = useState("WATERMARK");
  const [watermark, setWatermark] = useState("u learn");

  // doc ai
  const [docAction, setDocAction] = useState("SUMMARIZE");

  const tabs = useMemo(
    () =>
      [
        ["library", "Library"],
        ["chat", "Chat"],
        ["exams", "Exams"],
        ["generate", "Generate"],
        ["docai", "Doc AI"],
        ["bank", "Question Bank"],
        ["pdf", "PDF Tools"],
        ["jobs", "Jobs"],
      ] as const,
    []
  );

  const loadDocs = useCallback(async () => {
    const res = await fetch("/api/teacher/ai/documents");
    if (!res.ok) return;
    const data = await res.json();
    setDocs(data.documents || []);
  }, []);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/teacher/ai/jobs");
    if (!res.ok) return;
    const data = await res.json();
    setJobs(data.jobs || []);
  }, []);

  const loadCourses = useCallback(async () => {
    const res = await fetch("/api/teacher/courses");
    if (!res.ok) return;
    const data = await res.json();
    setCourses((data.courses || []).map((c: Course) => ({ id: c.id, titleEn: c.titleEn })));
  }, []);

  const loadBank = useCallback(async () => {
    const res = await fetch(
      `/api/teacher/ai/question-bank${bankQ ? `?q=${encodeURIComponent(bankQ)}` : ""}`
    );
    if (!res.ok) return;
    const data = await res.json();
    setBank(data.items || []);
  }, [bankQ]);

  useEffect(() => {
    void loadDocs();
    void loadJobs();
    void loadCourses();
  }, [loadDocs, loadJobs, loadCourses]);

  useEffect(() => {
    if (tab === "bank") void loadBank();
    if (tab === "jobs") void loadJobs();
  }, [tab, loadBank, loadJobs]);

  function toggleDoc(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const file of Array.from(files)) {
        const presign = await fetch("/api/admin/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            category: "document",
            folder: "professor-docs",
          }),
        });
        const up = await presign.json();
        if (!presign.ok) throw new Error(up.error || "Presign failed");
        const put = await fetch(up.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!put.ok) throw new Error("Upload failed");
        const create = await fetch("/api/teacher/ai/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            fileKey: up.key,
            fileUrl: up.publicUrl,
            mimeType: file.type,
            language: locale,
          }),
        });
        const created = await create.json();
        if (!create.ok) throw new Error(created.error || "Create failed");
      }
      setMsg("Upload queued for OCR + embedding");
      await loadDocs();
      await loadJobs();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setChatLog((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    try {
      const res = await fetch("/api/teacher/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          language: locale,
          documentIds: selected.length ? selected : undefined,
          conversationId: conversationId || undefined,
          stream: true,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Chat failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      setChatLog((m) => [...m, { role: "assistant", text: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6)) as {
            type: string;
            text?: string;
            answer?: string;
            conversationId?: string;
            message?: string;
          };
          if (evt.type === "token" && evt.text) {
            acc += evt.text;
            setChatLog((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: "assistant", text: acc };
              return copy;
            });
          }
          if (evt.type === "done") {
            if (evt.conversationId) setConversationId(evt.conversationId);
            if (evt.answer) {
              setChatLog((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: "assistant", text: evt.answer! };
                return copy;
              });
            }
          }
          if (evt.type === "error") throw new Error(evt.message || "Chat failed");
        }
      }
    } catch (e) {
      setChatLog((m) => [
        ...m,
        { role: "assistant", text: e instanceof Error ? e.message : "Chat failed" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function generateExam() {
    if (!selected.length) {
      setMsg("Select at least one READY document");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/teacher/ai/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: selected,
          titleEn: examTitle || undefined,
          count: examCount,
          language: locale,
          courseId: courseId || undefined,
          publish: Boolean(courseId),
          versions: ["A", "B", "C"],
          saveToBank: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(`Exam job started: ${data.jobId}`);
      await loadJobs();
      setTab("jobs");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function startGeneration() {
    if (!genTitle.trim()) {
      setMsg("Title required");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/teacher/ai/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: genType,
          title: genTitle,
          language: locale,
          params: {
            topic: genTopic,
            pages: genPages,
            documentIds: selected.length ? selected : undefined,
            courseId: courseId || undefined,
            exportFormats: ["markdown", "html", "pdf", "docx", "pptx"],
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(`Generation job: ${data.jobId}`);
      setTab("jobs");
      await loadJobs();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function runDocAction() {
    if (selected.length !== 1) {
      setMsg("Select exactly one document");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/teacher/ai/document-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: selected[0],
          action: docAction,
          language: locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(`Doc AI job: ${data.jobId}`);
      setTab("jobs");
      await loadJobs();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function runPdfTool() {
    if (!selected.length) {
      setMsg("Select document(s)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/teacher/ai/pdf-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: pdfTool,
          documentIds: selected,
          options: {
            watermarkText: watermark,
            compareWithDocumentId: selected[1],
            rotateDegrees: 90,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(`PDF job: ${data.jobId}`);
      setTab("jobs");
      await loadJobs();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function gradeEssay() {
    setBusy(true);
    try {
      const res = await fetch("/api/teacher/ai/question-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grade",
          questionText: gradeQ,
          studentAnswer: gradeA,
          language: locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(`Grading job: ${data.jobId}`);
      setTab("jobs");
      await loadJobs();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function artifactLink(job: Job) {
    const artifactId =
      (job.resultJson?.artifactId as string | undefined) ||
      (Array.isArray(job.resultJson?.artifactIds)
        ? (job.resultJson!.artifactIds as string[])[0]
        : undefined);
    if (!artifactId) return null;
    return `/api/teacher/ai/artifacts/${artifactId}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.nav.aiStudio}
        description="Upload private materials, chat with your docs, generate content, exams, and PDF tools."
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              tab === id
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {msg && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </div>
      )}

      {tab === "library" && (
        <Card className="space-y-4 p-4">
          <div
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center dark:border-slate-700 dark:bg-slate-900/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void uploadFiles(e.dataTransfer.files);
            }}
          >
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
              Drag & drop PDFs/DOCX, or choose files
            </p>
            <label className="cursor-pointer">
              <span className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
                {busy ? "Uploading…" : "Upload materials"}
              </span>
              <input
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.doc,.docx,.txt,.md"
                disabled={busy}
                onChange={(e) => void uploadFiles(e.target.files)}
              />
            </label>
          </div>
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <input
                  type="checkbox"
                  checked={selected.includes(d.id)}
                  onChange={() => toggleDoc(d.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.fileName}</div>
                  <div className="text-xs text-slate-500">
                    {d.status} · {d.chunkCount ?? 0} chunks
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await fetch(`/api/teacher/ai/documents/${d.id}`, { method: "DELETE" });
                    await loadDocs();
                  }}
                >
                  Delete
                </Button>
              </li>
            ))}
            {!docs.length && (
              <li className="py-6 text-center text-sm text-slate-500">No documents yet</li>
            )}
          </ul>
        </Card>
      )}

      {tab === "chat" && (
        <Card className="flex h-[560px] flex-col p-4">
          <div className="mb-2 text-xs text-slate-500">
            Scoped to your uploads{selected.length ? ` · ${selected.length} selected` : ""}
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
            {chatLog.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "ml-auto bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "bg-white shadow-sm dark:bg-slate-800"
                )}
              >
                {m.text}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendChat()}
              placeholder="Ask about your documents…"
            />
            <Button onClick={() => void sendChat()} disabled={busy}>
              Send
            </Button>
          </div>
        </Card>
      )}

      {tab === "exams" && (
        <Card className="space-y-4 p-4">
          <p className="text-sm text-slate-600">
            Select READY documents, optionally pick a course to publish the quiz.
          </p>
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            placeholder="Exam title"
            value={examTitle}
            onChange={(e) => setExamTitle(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <select
              className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              <option value="">Preview only (no publish)</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.titleEn}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={3}
              max={20}
              className="w-24 rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={examCount}
              onChange={(e) => setExamCount(Number(e.target.value))}
            />
          </div>
          <Button onClick={() => void generateExam()} disabled={busy}>
            Generate exam (A/B/C + bank)
          </Button>
        </Card>
      )}

      {tab === "generate" && (
        <Card className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <select
              className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={genType}
              onChange={(e) => setGenType(e.target.value as (typeof GEN_TYPES)[number])}
            >
              {GEN_TYPES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <input
              className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              placeholder="Title"
              value={genTitle}
              onChange={(e) => setGenTitle(e.target.value)}
            />
            <input
              className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              placeholder="Topic"
              value={genTopic}
              onChange={(e) => setGenTopic(e.target.value)}
            />
            <input
              type="number"
              min={1}
              max={30}
              className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={genPages}
              onChange={(e) => setGenPages(Number(e.target.value))}
            />
          </div>
          <Button onClick={() => void startGeneration()} disabled={busy}>
            Generate + export MD/HTML/PDF/DOCX/PPTX
          </Button>
        </Card>
      )}

      {tab === "docai" && (
        <Card className="space-y-4 p-4">
          <select
            className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            value={docAction}
            onChange={(e) => setDocAction(e.target.value)}
          >
            {DOC_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button onClick={() => void runDocAction()} disabled={busy}>
            Run document action
          </Button>
        </Card>
      )}

      {tab === "bank" && (
        <Card className="space-y-4 p-4">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              placeholder="Search bank…"
              value={bankQ}
              onChange={(e) => setBankQ(e.target.value)}
            />
            <Button onClick={() => void loadBank()}>Search</Button>
          </div>
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {bank.map((item) => (
              <li key={String(item.id)} className="rounded-lg border p-3 dark:border-slate-800">
                <div className="text-xs text-slate-500">
                  {String(item.questionType)} · {String(item.difficulty || "-")}
                </div>
                <div>{String(item.text)}</div>
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t pt-4 dark:border-slate-800">
            <h3 className="font-semibold">Essay grading assist</h3>
            <textarea
              className="w-full rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              rows={2}
              placeholder="Question"
              value={gradeQ}
              onChange={(e) => setGradeQ(e.target.value)}
            />
            <textarea
              className="w-full rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              rows={3}
              placeholder="Student answer"
              value={gradeA}
              onChange={(e) => setGradeA(e.target.value)}
            />
            <Button onClick={() => void gradeEssay()} disabled={busy || !gradeQ || !gradeA}>
              Grade (review before release)
            </Button>
          </div>
        </Card>
      )}

      {tab === "pdf" && (
        <Card className="space-y-4 p-4">
          <select
            className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            value={pdfTool}
            onChange={(e) => setPdfTool(e.target.value)}
          >
            {PDF_TOOLS.map((tool) => (
              <option key={tool} value={tool}>
                {tool}
              </option>
            ))}
          </select>
          {pdfTool === "WATERMARK" && (
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={watermark}
              onChange={(e) => setWatermark(e.target.value)}
            />
          )}
          <Button onClick={() => void runPdfTool()} disabled={busy}>
            Run PDF tool
          </Button>
        </Card>
      )}

      {tab === "jobs" && (
        <Card className="space-y-3 p-4">
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => void loadJobs()}>
              Refresh
            </Button>
          </div>
          <ul className="divide-y dark:divide-slate-800">
            {jobs.map((j) => {
              const href = artifactLink(j);
              return (
                <li key={j.id} className="flex items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {j.type} · {j.status} · {j.progress}%
                    </div>
                    {j.errorMessage && (
                      <div className="text-xs text-red-600">{j.errorMessage}</div>
                    )}
                  </div>
                  {href && j.status === "SUCCEEDED" && (
                    <a className="text-sky-600 underline" href={href} target="_blank" rel="noreferrer">
                      Download
                    </a>
                  )}
                </li>
              );
            })}
            {!jobs.length && (
              <li className="py-6 text-center text-slate-500">No jobs yet</li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}
