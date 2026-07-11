"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";

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
};

export function AiKnowledgeClient() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({
    language: "en",
    grade: "",
    semester: "",
    chapter: "",
    lesson: "",
    topic: "",
  });

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/ai/knowledge-base");
    if (!r.ok) throw new Error("SUPER_ADMIN required");
    const data = await r.json();
    setDocs(data.documents || []);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
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

      const create = await fetch("/api/admin/ai/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileKey: key,
          fileUrl: publicUrl,
          mimeType: file.type || undefined,
          ...meta,
        }),
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
        description="Upload PDF / TXT / DOCX corpus docs. Processing extracts, chunks, and embeds for RAG."
      />
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      <div className="card mb-6 grid gap-3 p-4 sm:grid-cols-3">
        <input
          className="input"
          placeholder="Language (en/ar/ku/tr)"
          value={meta.language}
          onChange={(e) => setMeta({ ...meta, language: e.target.value })}
        />
        <input
          className="input"
          placeholder="Grade"
          value={meta.grade}
          onChange={(e) => setMeta({ ...meta, grade: e.target.value })}
        />
        <input
          className="input"
          placeholder="Semester"
          value={meta.semester}
          onChange={(e) => setMeta({ ...meta, semester: e.target.value })}
        />
        <input
          className="input"
          placeholder="Chapter"
          value={meta.chapter}
          onChange={(e) => setMeta({ ...meta, chapter: e.target.value })}
        />
        <input
          className="input"
          placeholder="Lesson"
          value={meta.lesson}
          onChange={(e) => setMeta({ ...meta, lesson: e.target.value })}
        />
        <input
          className="input"
          placeholder="Topic"
          value={meta.topic}
          onChange={(e) => setMeta({ ...meta, topic: e.target.value })}
        />
        <label className="sm:col-span-3">
          <span className="mb-1 block text-sm text-muted">Upload document (PDF, TXT, DOCX)</span>
          <input
            type="file"
            accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
        </label>
      </div>

      <div className="space-y-3">
        {docs.map((d) => (
          <div key={d.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-semibold">{d.fileName}</div>
              <div className="text-sm text-muted">
                {d.sourceType} · v{d.version} · {d.status} · {d.chunkCount} chunks
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
