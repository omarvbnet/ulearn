"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { useToast } from "@/components/overlay";
import { cn } from "@/lib/utils";

type Status = {
  access: boolean;
  reason: string;
  remaining: number;
  freeUses: number;
  used: number;
  courseCount: number;
  unlockCount: number;
  monthlyPrice: number;
  currency: string;
  packages: Array<{
    id: string;
    nameEn: string;
    price: number;
    currency: string;
  }>;
  offers: Array<{
    id: string;
    label: string;
    price: number;
    durationDays: number;
    packageId?: string;
  }>;
};

type Tab = "merge" | "design" | "image";

function downloadBase64(fileName: string, mime: string, b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

async function fileToPayload(file: File) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    dataBase64: btoa(binary),
  };
}

export default function CreativeStudioPage() {
  const { locale } = useParams<{ locale: string }>();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("merge");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [designFormat, setDesignFormat] = useState<"ppt" | "pdf">("ppt");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [outline, setOutline] = useState("");
  const [imageMode, setImageMode] = useState<"design" | "edit">("design");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/ai/creative/status");
    if (!res.ok) return;
    const data = await res.json();
    setStatus(data.status);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function requestPackage(packageId: string) {
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId }),
    });
    if (res.ok) toast("Activation request sent");
    else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Request failed", "error");
    }
  }

  async function run(path: string, body: unknown) {
    if (status && !status.access) {
      toast("Upgrade required", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 402) {
        await loadStatus();
        toast("No free uses left — upgrade to continue", "error");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Request failed");
      const result = data.result;
      downloadBase64(result.fileName, result.mimeType, result.dataBase64);
      toast("Download started");
      await loadStatus();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="AI Creative Studio"
        description="Merge PDFs, design PPT/PDF, and create or edit images."
        actions={
          <Link
            href={`/${locale}/student/ai`}
            className="text-sm text-muted underline-offset-2 hover:underline"
          >
            Back to AI chat
          </Link>
        }
      />

      <Card className="space-y-3">
        {!status ? (
          <p className="text-sm text-muted">Loading entitlement…</p>
        ) : (
          <>
            <p className="text-sm">
              {status.reason === "SUBSCRIPTION"
                ? "AI Creative plan active"
                : status.reason === "COURSES_UNLOCK"
                  ? `Unlocked via ${status.courseCount}/${status.unlockCount} paid courses`
                  : status.access
                    ? `${status.remaining} free uses left (${status.used}/${status.freeUses} used)`
                    : "No free uses left — upgrade to continue"}
            </p>
            {(!status.access || status.reason === "FREE") && (
              <div className="flex flex-wrap gap-2">
                {status.packages.map((p) => (
                  <Button
                    key={p.id}
                    disabled={busy}
                    onClick={() => void requestPackage(p.id)}
                  >
                    {p.nameEn} — {p.price} {p.currency}
                  </Button>
                ))}
                {status.offers
                  .filter((o) => o.packageId)
                  .map((o) => (
                    <Button
                      key={o.id}
                      disabled={busy}
                      onClick={() => void requestPackage(o.packageId!)}
                    >
                      {o.label} — {o.price} {status.currency}
                    </Button>
                  ))}
                {status.packages.length === 0 && (
                  <p className="text-xs text-muted">
                    Monthly from {status.monthlyPrice} {status.currency}. Buy{" "}
                    {status.unlockCount} paid courses or ask admin for an AI Creative package.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <div className="flex gap-2">
        {(["merge", "design", "image"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium capitalize",
              tab === t
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-muted"
            )}
          >
            {t === "merge" ? "Merge" : t === "design" ? "Design" : "Images"}
          </button>
        ))}
      </div>

      {tab === "merge" && (
        <Card className="space-y-4">
          <p className="text-sm text-muted">Select 2+ PDF files to merge.</p>
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => setMergeFiles(Array.from(e.target.files || []))}
          />
          <ul className="text-sm">
            {mergeFiles.map((f) => (
              <li key={f.name + f.size}>{f.name}</li>
            ))}
          </ul>
          <Button
            disabled={busy || mergeFiles.length < 2}
            onClick={() =>
              void (async () => {
                const files = await Promise.all(mergeFiles.map(fileToPayload));
                await run("/api/ai/creative/merge", { files });
              })()
            }
          >
            {busy ? "Working…" : "Merge PDFs"}
          </Button>
        </Card>
      )}

      {tab === "design" && (
        <Card className="space-y-4">
          <Select
            label="Format"
            value={designFormat}
            onChange={(e) => setDesignFormat(e.target.value as "ppt" | "pdf")}
          >
            <option value="ppt">PowerPoint</option>
            <option value="pdf">PDF</option>
          </Select>
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="block text-sm">
            Prompt
            <textarea
              className="mt-1 min-h-[100px] w-full rounded-lg border border-[var(--border)] bg-transparent p-3 text-sm"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Outline (optional)
            <textarea
              className="mt-1 min-h-[80px] w-full rounded-lg border border-[var(--border)] bg-transparent p-3 text-sm"
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !title.trim() || !prompt.trim()}
            onClick={() =>
              void run("/api/ai/creative/design", {
                format: designFormat,
                title: title.trim(),
                prompt: prompt.trim(),
                outline: outline.trim() || undefined,
                language: locale,
              })
            }
          >
            {busy ? "Working…" : "Generate"}
          </Button>
        </Card>
      )}

      {tab === "image" && (
        <Card className="space-y-4">
          <Select
            label="Mode"
            value={imageMode}
            onChange={(e) => setImageMode(e.target.value as "design" | "edit")}
          >
            <option value="design">Design</option>
            <option value="edit">Edit</option>
          </Select>
          {imageMode === "edit" && (
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0] || null)}
            />
          )}
          <label className="block text-sm">
            Prompt
            <textarea
              className="mt-1 min-h-[100px] w-full rounded-lg border border-[var(--border)] bg-transparent p-3 text-sm"
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
            />
          </label>
          <Button
            disabled={
              busy ||
              !imagePrompt.trim() ||
              (imageMode === "edit" && !imageFile)
            }
            onClick={() =>
              void (async () => {
                await run("/api/ai/creative/image", {
                  mode: imageMode,
                  prompt: imagePrompt.trim(),
                  language: locale,
                  image: imageFile ? await fileToPayload(imageFile) : undefined,
                });
              })()
            }
          >
            {busy ? "Working…" : "Create"}
          </Button>
        </Card>
      )}
    </div>
  );
}
