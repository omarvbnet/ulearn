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
  isCertificateTrack?: boolean;
  subjects: { id: string; nameEn: string; nameAr: string }[];
};

const GRADES = [
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
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
  const [activeStageId, setActiveStageId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [quizMsg, setQuizMsg] = useState("");
  const [meta, setMeta] = useState({
    language: "en",
    grade: "",
    subjectId: "",
    semester: "",
    chapter: "",
    lesson: "",
    topic: "",
  });

  const activeStage = useMemo(
    () => stages.find((s) => s.id === activeStageId) || null,
    [stages, activeStageId]
  );
  const subjects = activeStage?.subjects ?? [];
  const isCertTrack = Boolean(activeStage?.isCertificateTrack);

  const load = useCallback(async (stageId: string) => {
    if (!stageId) {
      setDocs([]);
      return;
    }
    const r = await fetch(
      `/api/admin/ai/knowledge-base?educationalStageId=${encodeURIComponent(stageId)}`
    );
    if (!r.ok) throw new Error("SUPER_ADMIN required");
    const data = await r.json();
    setDocs(data.documents || []);
  }, []);

  useEffect(() => {
    fetch("/api/admin/courses/tree")
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        const list = (data.stages || []) as Stage[];
        setStages(list);
        setActiveStageId((prev) => prev || list[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeStageId) return;
    load(activeStageId).catch((e) => setError(e.message));
    const t = setInterval(() => load(activeStageId).catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [activeStageId, load]);

  async function onFile(file: File | null) {
    if (!file) return;
    if (!activeStageId) {
      setError("Select an educational stage before uploading.");
      return;
    }
    if (isCertTrack && !meta.subjectId) {
      setError("Select an Area of Interest (subject) for Professional Certificates materials.");
      return;
    }
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

      const create = await fetch("/api/admin/ai/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileKey: key,
          fileUrl: publicUrl,
          mimeType: file.type || undefined,
          educationalStageId: activeStageId,
          language: meta.language || undefined,
          grade: meta.grade || undefined,
          subjectId: meta.subjectId || undefined,
          semester: meta.semester || undefined,
          chapter: meta.chapter || undefined,
          lesson: meta.lesson || undefined,
          topic: meta.topic || undefined,
        }),
      });
      if (!create.ok) {
        const err = await create.json().catch(() => ({}));
        throw new Error(err.error || "KB create failed");
      }
      await load(activeStageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const ready = docs.filter((d) => d.status === "READY").length;
  const failed = docs.filter((d) => d.status === "FAILED").length;

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        description="Upload materials per educational stage. Students only retrieve docs from their own stage."
      />
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      <div className="card mb-4 p-4">
        <Select
          label="Working stage"
          value={activeStageId}
          onChange={(e) => {
            setActiveStageId(e.target.value);
            setMeta((m) => ({ ...m, subjectId: "" }));
            setSelectedDocIds([]);
          }}
        >
          <option value="">Select a stage…</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nameEn}
              {s.isCertificateTrack ? " (Certificates)" : ""}
            </option>
          ))}
        </Select>
        <FieldHint>
          Switch stages to manage each curriculum separately. Use{" "}
          <strong>Professional Certificates</strong> for certificate-user materials by area of
          interest. AI chat fetches matching materials for each learner.
        </FieldHint>
        {activeStage ? (
          <p className="mt-3 text-sm text-muted">
            <span className="font-medium text-foreground">{activeStage.nameEn}</span>
            {" · "}
            {docs.length} file(s) · {ready} ready · {failed} failed
          </p>
        ) : null}
      </div>

      {!activeStageId ? (
        <p className="text-muted">Select a stage to upload and review its materials.</p>
      ) : (
        <>
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
              <FieldHint>Document language (answers still follow the app UI language).</FieldHint>
            </div>

            <div>
              <Select
                label="Grade"
                value={meta.grade}
                onChange={(e) => setMeta({ ...meta, grade: e.target.value })}
              >
                <option value="">Any / not specified</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </Select>
              <FieldHint>Optional class year inside this stage.</FieldHint>
            </div>

            <div>
              <Select
                label={isCertTrack ? "Area of Interest *" : "Subject"}
                value={meta.subjectId}
                onChange={(e) => setMeta({ ...meta, subjectId: e.target.value })}
              >
                <option value="">
                  {isCertTrack ? "Select area…" : "Any subject in stage"}
                </option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.nameEn}</option>
                ))}
              </Select>
              <FieldHint>
                {isCertTrack
                  ? "Required for certificate-track materials so AI and courses match user interests."
                  : "Optional subject within the selected stage."}
              </FieldHint>
            </div>

            <div>
              <Select
                label="Semester"
                value={meta.semester}
                onChange={(e) => setMeta({ ...meta, semester: e.target.value })}
              >
                <option value="">Any / not specified</option>
                {SEMESTERS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>

            <div>
              <Input
                label="Chapter"
                placeholder="e.g. Chapter 3 — Forces"
                value={meta.chapter}
                onChange={(e) => setMeta({ ...meta, chapter: e.target.value })}
              />
            </div>
            <div>
              <Input
                label="Lesson"
                placeholder="e.g. Newton’s 2nd law"
                value={meta.lesson}
                onChange={(e) => setMeta({ ...meta, lesson: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Input
                label="Topic"
                placeholder="e.g. acceleration, free fall"
                value={meta.topic}
                onChange={(e) => setMeta({ ...meta, topic: e.target.value })}
              />
            </div>

            <label className="sm:col-span-2 lg:col-span-3">
              <span className="label">
                Upload for {activeStage?.nameEn || "stage"} (PDF, TXT, DOCX)
              </span>
              <input
                type="file"
                className="mt-1 block w-full text-sm"
                accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={busy}
                onChange={(e) => onFile(e.target.files?.[0] || null)}
              />
              <FieldHint>
                Each file is tagged with this stage so students only retrieve matching curriculum.
              </FieldHint>
            </label>
          </div>

          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Materials in this stage
          </h3>
          {docs.some((d) => d.status === "READY") ? (
            <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
              <button
                className="btn"
                type="button"
                disabled={busy || selectedDocIds.length < 1}
                onClick={async () => {
                  setBusy(true);
                  setQuizMsg("");
                  setError("");
                  try {
                    const r = await fetch("/api/admin/ai/generate-quiz", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        educationalStageId: activeStageId,
                        subjectId: meta.subjectId || undefined,
                        documentIds: selectedDocIds,
                        publish: true,
                        language: meta.language || "en",
                      }),
                    });
                    const data = await r.json();
                    if (!r.ok) throw new Error(data.error || "Quiz generation failed");
                    setQuizMsg(
                      data.quiz?.id
                        ? `Quiz created (${data.quiz.id}) with ${data.quiz.questions?.length ?? "?"} questions.`
                        : "Quiz generated."
                    );
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Quiz failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Generate quiz from selected
              </button>
              <span className="text-sm text-muted">
                {selectedDocIds.length} selected READY doc(s)
              </span>
              {quizMsg ? <p className="w-full text-sm text-emerald-600">{quizMsg}</p> : null}
            </div>
          ) : null}
          <div className="space-y-3">
            {docs.map((d) => (
              <div key={d.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-start gap-3">
                  {d.status === "READY" ? (
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedDocIds.includes(d.id)}
                      onChange={(e) => {
                        setSelectedDocIds((prev) =>
                          e.target.checked
                            ? [...prev, d.id]
                            : prev.filter((id) => id !== d.id)
                        );
                      }}
                    />
                  ) : (
                    <span className="mt-1 inline-block w-4" />
                  )}
                  <div>
                    <div className="font-semibold">{d.fileName}</div>
                    <div className="text-sm text-muted">
                      {d.status} · v{d.version} · {d.chunkCount} chunks
                      {d.grade ? ` · ${d.grade}` : ""}
                      {d.errorMessage ? ` · ${d.errorMessage}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await fetch(`/api/admin/ai/knowledge-base/${d.id}/reprocess`, {
                        method: "POST",
                      });
                      await load(activeStageId);
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
                      await load(activeStageId);
                    }}
                  >
                    Archive
                  </button>
                </div>
              </div>
            ))}
            {!docs.length ? (
              <p className="text-muted">No materials for this stage yet — upload the first document above.</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
