"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";

type Provider = {
  id: string;
  name: string;
  type: string;
  model: string;
  baseUrl: string | null;
  status: string;
  isDefault: boolean;
  hasApiKey: boolean;
  temperature: number;
  maxTokens: number;
};

type Assignment = { id: string; moduleKey: string; providerId: string };

type Diagnostics = {
  ok: boolean;
  latencyMs: number;
  embedding: { ok: boolean; dims: number; latencyMs: number; error: string | null };
  chat: { ok: boolean; latencyMs: number; sample: string; error: string | null };
  knowledgeBase: {
    total: number;
    ready: number;
    failed: number;
    byStage: {
      stageId: string;
      stageName: string;
      total: number;
      ready: number;
      failed: number;
      pending: number;
    }[];
    unscoped: number;
    failedDocs: { id: string; fileName: string; errorMessage: string | null }[];
  };
  issues: { severity: "error" | "warning" | "ok"; code: string; message: string; fix?: string }[];
  checkedAt: string;
};

const MODULES = [
  "TEACHING_ASSISTANT",
  "EXAM_GENERATOR",
  "OCR_ANALYSIS",
  "EMBEDDING",
  "RECOMMENDATION",
] as const;

export function AiProvidersClient() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [form, setForm] = useState({
    name: "Gemini Default",
    type: "GEMINI",
    model: "gemini-2.0-flash",
    apiKey: "",
    baseUrl: "",
    isDefault: true,
  });

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/ai/providers");
    if (!r.ok) throw new Error("SUPER_ADMIN required");
    const data = await r.json();
    setProviders(data.providers || []);
    setAssignments(data.assignments || []);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  async function runDiagnostics() {
    setDiagBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/ai/diagnostics", { method: "POST" });
      if (!r.ok) throw new Error("Diagnostics failed");
      setDiagnostics(await r.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagnostics failed");
    } finally {
      setDiagBusy(false);
    }
  }

  async function createProvider(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          baseUrl: form.baseUrl || undefined,
          apiKey: form.apiKey || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Create failed");
      setForm({ ...form, apiKey: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/ai/providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Update failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/ai/providers/${id}/test`, { method: "POST" });
      const data = await r.json();
      alert(data.message || (data.ok ? "OK" : "Failed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveAssignments() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/ai/module-assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments: MODULES.map((moduleKey) => {
            const existing = assignments.find((a) => a.moduleKey === moduleKey);
            const defaultId = providers.find((p) => p.isDefault)?.id || providers[0]?.id;
            return { moduleKey, providerId: existing?.providerId || defaultId };
          }).filter((a) => a.providerId),
        }),
      });
      if (!r.ok) throw new Error("Save assignments failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !providers.length) {
    return (
      <div className="card p-8 text-center">
        <p className="text-muted">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="AI Providers"
        description="Configure Gemini / OpenAI / Anthropic providers, defaults, and module routing (SUPER_ADMIN)"
      />
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      <div className="card mb-6 space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">AI system test</div>
            <p className="text-sm text-muted">
              Checks API key connectivity (embedding + chat) and knowledge-base readiness per stage.
            </p>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            disabled={diagBusy}
            onClick={runDiagnostics}
          >
            {diagBusy ? "Running…" : "Run connection test"}
          </button>
        </div>

        {diagnostics ? (
          <div className="space-y-3 border-t border-card-border pt-3">
            <p className="text-sm">
              Overall:{" "}
              <span className={diagnostics.ok ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                {diagnostics.ok ? "Healthy" : "Issues found"}
              </span>
              {" · "}
              {diagnostics.latencyMs}ms · {new Date(diagnostics.checkedAt).toLocaleString()}
            </p>
            <div className="grid gap-2 sm:grid-cols-3 text-sm">
              <div className="rounded-lg border border-card-border p-3">
                Embedding: {diagnostics.embedding.ok ? "OK" : "FAIL"}
                {diagnostics.embedding.ok
                  ? ` (${diagnostics.embedding.dims}d, ${diagnostics.embedding.latencyMs}ms)`
                  : ` — ${diagnostics.embedding.error}`}
              </div>
              <div className="rounded-lg border border-card-border p-3">
                Chat: {diagnostics.chat.ok ? "OK" : "FAIL"}
                {diagnostics.chat.ok
                  ? ` (${diagnostics.chat.latencyMs}ms)`
                  : ` — ${diagnostics.chat.error}`}
              </div>
              <div className="rounded-lg border border-card-border p-3">
                KB: {diagnostics.knowledgeBase.ready} ready / {diagnostics.knowledgeBase.total} total
                {diagnostics.knowledgeBase.failed
                  ? ` · ${diagnostics.knowledgeBase.failed} failed`
                  : ""}
              </div>
            </div>

            {diagnostics.knowledgeBase.byStage.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-muted">
                      <th className="py-1 pr-3">Stage</th>
                      <th className="py-1 pr-3">Ready</th>
                      <th className="py-1 pr-3">Failed</th>
                      <th className="py-1 pr-3">Pending</th>
                      <th className="py-1">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostics.knowledgeBase.byStage.map((s) => (
                      <tr key={s.stageId} className="border-t border-card-border/60">
                        <td className="py-1.5 pr-3">{s.stageName}</td>
                        <td className="py-1.5 pr-3">{s.ready}</td>
                        <td className="py-1.5 pr-3">{s.failed}</td>
                        <td className="py-1.5 pr-3">{s.pending}</td>
                        <td className="py-1.5">{s.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <ul className="space-y-2">
              {diagnostics.issues.map((i) => (
                <li
                  key={i.code + i.message}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    i.severity === "error"
                      ? "bg-red-500/10 text-red-700 dark:text-red-300"
                      : i.severity === "warning"
                        ? "bg-amber-500/10 text-amber-800 dark:text-amber-200"
                        : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                  }`}
                >
                  <div className="font-medium">
                    [{i.severity}] {i.message}
                  </div>
                  {i.fix ? <div className="mt-0.5 opacity-90">Fix: {i.fix}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <form onSubmit={createProvider} className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <input
          className="input"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <select
          className="input"
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        >
          <option value="GEMINI">Gemini</option>
          <option value="OPENAI">OpenAI</option>
          <option value="ANTHROPIC">Anthropic</option>
          <option value="OPENAI_COMPATIBLE">OpenAI Compatible</option>
        </select>
        <input
          className="input"
          placeholder="Model"
          value={form.model}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
          required
        />
        <input
          className="input"
          placeholder="API key"
          type="password"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        />
        <input
          className="input"
          placeholder="Base URL (optional)"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
          />
          Set as default
        </label>
        <button className="btn btn-primary sm:col-span-2 lg:col-span-3" disabled={busy} type="submit">
          Add provider
        </button>
      </form>

      <div className="mb-8 space-y-3">
        {providers.map((p) => (
          <div key={p.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-semibold">
                {p.name}{" "}
                {p.isDefault ? (
                  <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                    default
                  </span>
                ) : null}
              </div>
              <div className="text-sm text-muted">
                {p.type} · {p.model} · {p.status} · key {p.hasApiKey ? "set" : "missing"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={busy} onClick={() => test(p.id)} type="button">
                Test
              </button>
              {!p.isDefault ? (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => patch(p.id, { isDefault: true })}
                  type="button"
                >
                  Make default
                </button>
              ) : null}
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  patch(p.id, { status: p.status === "ENABLED" ? "DISABLED" : "ENABLED" })
                }
                type="button"
              >
                {p.status === "ENABLED" ? "Disable" : "Enable"}
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (confirm("Delete provider?")) {
                    fetch(`/api/admin/ai/providers/${p.id}`, { method: "DELETE" }).then(load);
                  }
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <PageHeader title="Module assignments" description="Route each AI module to a provider" />
      <div className="card space-y-3 p-4">
        {MODULES.map((moduleKey) => {
          const current = assignments.find((a) => a.moduleKey === moduleKey)?.providerId || "";
          return (
            <label key={moduleKey} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-48 font-medium">{moduleKey}</span>
              <select
                className="input max-w-md flex-1"
                value={current}
                onChange={(e) => {
                  const providerId = e.target.value;
                  setAssignments((prev) => {
                    const rest = prev.filter((a) => a.moduleKey !== moduleKey);
                    return [...rest, { id: moduleKey, moduleKey, providerId }];
                  });
                }}
              >
                <option value="">—</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type})
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <button className="btn btn-primary" disabled={busy || !providers.length} onClick={saveAssignments} type="button">
          Save assignments
        </button>
      </div>
    </div>
  );
}
