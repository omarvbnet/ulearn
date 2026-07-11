"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, Select, Input } from "@/components/ui";

type Doc = {
  id: string;
  fileName: string;
  sourceType: string;
  status: string;
  chunkCount: number;
  errorMessage: string | null;
  language: string | null;
  uploadedAt: string;
  processedAt: string | null;
  version: number;
  mimeType: string | null;
  educationalStageId?: string | null;
  grade?: string | null;
  subjectId?: string | null;
};

type Stage = {
  id: string;
  nameEn: string;
  nameAr: string;
  subjects: { id: string; nameEn: string; nameAr: string }[];
};

const GRADES = [
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
  "Grade 6",
  "Grade 7",
  "Grade 8",
  "Grade 9",
  "Grade 10",
  "Grade 11",
  "Grade 12",
];

const SEMESTERS = [
  { value: "1", label: "Semester 1 / First term" },
  { value: "2", label: "Semester 2 / Second term" },
  { value: "full", label: "Full year" },
];

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-muted leading-snug">{children}</p>;
}

export function AiKnowledgeClient() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({
    language: "en",
    educationalStageId: "",
    grade: "",
    subjectId: "",
    semester: "",
    chapter: "",
    lesson: "",
    topic: "",
  });

  const subjects = useMemo(() => {
    const stage = stages.find((s) => s.id === meta.educationalStageId);
    return stage?.subjects ?? [];
  }, [stages, meta.educationalStageId]);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/ai/knowledge-base");
    if (!r.ok) throw new Error("SUPER_ADMIN required");
    const data = await r.json();
    setDocs(data.documents || []);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
    fetch("/api/admin/courses/tree")
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        setStages(data.stages || []);
      })
      .catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [load]);

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const presign = await fetch("/api/admin/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          category: "document",
          folder: "kb",
        }),
      });
      if (!presign.ok) throw new Error("Upload URL failed");
      const { uploadUrl, key, publicUrl } = await presign.json();

      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("File upload failed");

      const payload = {
        fileName: file.name,
        fileKey: key,
        fileUrl: publicUrl,
        mimeType: file.type || undefined,
        language: meta.language || undefined,
        educationalStageId: meta.educationalStageId || undefined,
        grade: meta.grade || undefined,
        subjectId: meta.subjectId || undefined,
        semester: meta.semester || undefined,
        chapter: meta.chapter || undefined,
        lesson: meta.lesson || undefined,
        topic: meta.topic || undefined,
      };

      const create = await fetch("/api/admin/ai/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!create.ok) throw new Error("KB create failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        description="Upload PDF / TXT / DOCX corpus docs. Metadata below scopes retrieval so students only get relevant chunks."
      />
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      <div className="card mb-6 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Select
            label="Language"
            value={meta.language}
            onChange={(e) => setMeta({ ...meta, language: e.target.value })}
          >
            <option value="en">English</option>
            <option value="ar">Arabic</option>
            <option value="ku">Kurdish</option>
            <option value="tr">Turkish</option>
          </Select>
          <FieldHint>Language of the document text — used to prefer matching answers for that locale.</FieldHint>
        </div>

        <div>
          <Select
            label="Educational stage"
            value={meta.educationalStageId}
            onChange={(e) =>
              setMeta({
                ...meta,
                educationalStageId: e.target.value,
                subjectId: "",
              })
            }
          >
            <option value="">Any / not specified</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameEn}
              </option>
            ))}
          </Select>
          <FieldHint>Same stages as Courses (e.g. Primary, Intermediate). Filters RAG by student stage.</FieldHint>
        </div>

        <div>
          <Select
            label="Grade"
            value={meta.grade}
            onChange={(e) => setMeta({ ...meta, grade: e.target.value })}
          >
            <option value="">Any / not specified</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <FieldHint>Specific class year inside the stage (Grade 1–12). Narrows search for that cohort.</FieldHint>
        </div>

        <div>
          <Select
            label="Subject"
            value={meta.subjectId}
            onChange={(e) => setMeta({ ...meta, subjectId: e.target.value })}
            disabled={!meta.educationalStageId}
          >
            <option value="">
              {meta.educationalStageId ? "Any subject in stage" : "Select a stage first"}
            </option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameEn}
              </option>
            ))}
          </Select>
          <FieldHint>Curriculum subject for this file (Math, Physics…). Pick a stage first to load subjects.</FieldHint>
        </div>

        <div>
          <Select
            label="Semester"
            value={meta.semester}
            onChange={(e) => setMeta({ ...meta, semester: e.target.value })}
          >
            <option value="">Any / not specified</option>
            {SEMESTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <FieldHint>Term this material belongs to — optional filter for mid-year content.</FieldHint>
        </div>

        <div>
          <Input
            label="Chapter"
            placeholder="e.g. Chapter 3 — Forces"
            value={meta.chapter}
            onChange={(e) => setMeta({ ...meta, chapter: e.target.value })}
          />
          <FieldHint>Chapter title or number from the book. Helps boost matches when students ask about that chapter.</FieldHint>
        </div>

        <div>
          <Input
            label="Lesson"
            placeholder="e.g. Newton’s 2nd law"
            value={meta.lesson}
            onChange={(e) => setMeta({ ...meta, lesson: e.target.value })}
          />
          <FieldHint>Lesson / unit name inside the chapter. Optional but improves citation precision.</FieldHint>
        </div>

        <div>
          <Input
            label="Topic"
            placeholder="e.g. acceleration, free fall"
            value={meta.topic}
            onChange={(e) => setMeta({ ...meta, topic: e.target.value })}
          />
          <FieldHint>Keywords or sub-topic tags for this document (comma-separated is fine).</FieldHint>
        </div>

        <label className="sm:col-span-2 lg:col-span-3">
          <span className="label">Upload document (PDF, TXT, DOCX)</span>
          <input
            type="file"
            className="mt-1 block w-full text-sm"
            accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
          <FieldHint>
            Fill metadata first, then choose the file. Processing extracts text, chunks it, and embeds for AI chat.
          </FieldHint>
        </label>
      </div>

      <div className="space-y-3">
        {docs.map((d) => (
          <div key={d.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-semibold">{d.fileName}</div>
              <div className="text-sm text-muted">
                {d.sourceType} · v{d.version} · {d.status} · {d.chunkCount} chunks
                {d.grade ? ` · ${d.grade}` : ""}
                {d.errorMessage ? ` · ${d.errorMessage}` : ""}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await fetch(`/api/admin/ai/knowledge-base/${d.id}/reprocess`, { method: "POST" });
                  await load();
                  setBusy(false);
                }}
              >
                Reprocess
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Archive document?")) return;
                  await fetch(`/api/admin/ai/knowledge-base/${d.id}`, { method: "DELETE" });
                  await load();
                }}
              >
                Archive
              </button>
            </div>
          </div>
        ))}
        {!docs.length ? <p className="text-muted">No knowledge documents yet.</p> : null}
      </div>
    </div>
  );
}
