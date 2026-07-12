"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui";
import { fetchJson, readResponseJson } from "@/lib/fetch-json";

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
  "PROFESSOR_CONTENT",
  "PROFESSOR_DOCUMENT",
  "AI_CREATIVE",
] as const;

const PROVIDER_TYPES = [
  { value: "GEMINI", label: "Google Gemini" },
  { value: "OPENAI", label: "OpenAI" },
  { value: "ANTHROPIC", label: "Claude (Anthropic)" },
  { value: "KIMI", label: "Kimi (Moonshot)" },
  { value: "DEEPSEEK", label: "DeepSeek" },
  { value: "JINA", label: "Jina AI (Embeddings)" },
  { value: "OPENAI_COMPATIBLE", label: "OpenAI Compatible (custom)" },
] as const;

const MODELS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  GEMINI: [
    { value: "gemini-2.0-flash", label: "gemini-2.0-flash" },
    { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    { value: "gemini-1.5-flash", label: "gemini-1.5-flash" },
    { value: "gemini-1.5-pro", label: "gemini-1.5-pro" },
    { value: "gemini-embedding-001", label: "gemini-embedding-001 (embeddings)" },
  ],
  OPENAI: [
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4o-mini", label: "gpt-4o-mini" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
    { value: "o4-mini", label: "o4-mini" },
    { value: "text-embedding-3-small", label: "text-embedding-3-small (embeddings)" },
  ],
  ANTHROPIC: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
    { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet (latest)" },
    { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (latest)" },
    { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku" },
  ],
  KIMI: [
    { value: "moonshot-v1-8k", label: "moonshot-v1-8k" },
    { value: "moonshot-v1-32k", label: "moonshot-v1-32k" },
    { value: "moonshot-v1-128k", label: "moonshot-v1-128k" },
    { value: "moonshot-v1-auto", label: "moonshot-v1-auto" },
    { value: "kimi-latest", label: "kimi-latest" },
  ],
  DEEPSEEK: [
    { value: "deepseek-chat", label: "deepseek-chat" },
    { value: "deepseek-reasoner", label: "deepseek-reasoner" },
  ],
  JINA: [
    { value: "jina-embeddings-v4", label: "jina-embeddings-v4 (recommended)" },
    { value: "jina-embeddings-v3", label: "jina-embeddings-v3" },
    { value: "jina-embeddings-v2-base-en", label: "jina-embeddings-v2-base-en" },
    { value: "jina-clip-v2", label: "jina-clip-v2 (multimodal)" },
  ],
  OPENAI_COMPATIBLE: [
    { value: "gpt-4o-mini", label: "gpt-4o-mini (compatible)" },
    { value: "deepseek-chat", label: "deepseek-chat" },
    { value: "moonshot-v1-8k", label: "moonshot-v1-8k" },
  ],
};

const DEFAULT_BASE_URL: Record<string, string> = {
  GEMINI: "https://generativelanguage.googleapis.com",
  OPENAI: "https://api.openai.com/v1",
  ANTHROPIC: "https://api.anthropic.com",
  KIMI: "https://api.moonshot.cn/v1",
  DEEPSEEK: "https://api.deepseek.com/v1",
  JINA: "https://api.jina.ai/v1",
  OPENAI_COMPATIBLE: "",
};

const DEFAULT_MODEL: Record<string, string> = {
  GEMINI: "gemini-2.0-flash",
  OPENAI: "gpt-4o-mini",
  ANTHROPIC: "claude-sonnet-4-20250514",
  KIMI: "moonshot-v1-8k",
  DEEPSEEK: "deepseek-chat",
  JINA: "jina-embeddings-v4",
  OPENAI_COMPATIBLE: "gpt-4o-mini",
};

const CUSTOM_MODEL = "__custom__";

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
    customModel: "",
    apiKey: "",
    baseUrl: DEFAULT_BASE_URL.GEMINI,
    isDefault: true,
  });

  const modelOptions = useMemo(
    () => MODELS_BY_TYPE[form.type] || MODELS_BY_TYPE.OPENAI_COMPATIBLE,
    [form.type]
  );

  const modelSelectValue = useMemo(() => {
    if (modelOptions.some((m) => m.value === form.model)) return form.model;
    return CUSTOM_MODEL;
  }, [form.model, modelOptions]);

  const load = useCallback(async () => {
    const { res, data } = await fetchJson<{ providers?: Provider[]; assignments?: Assignment[] }>(
      "/api/admin/ai/providers"
    );
    if (!res.ok) throw new Error("SUPER_ADMIN required");
    setProviders(data.providers || []);
    setAssignments(data.assignments || []);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  function onTypeChange(type: string) {
    const nextModel = DEFAULT_MODEL[type] || "gpt-4o-mini";
    setForm((f) => ({
      ...f,
      type,
      model: nextModel,
      customModel: "",
      baseUrl: DEFAULT_BASE_URL[type] ?? f.baseUrl,
      name:
        f.name === "Gemini Default" ||
        f.name.endsWith(" Default") ||
        PROVIDER_TYPES.some((t) => f.name === `${t.label} Default`)
          ? `${PROVIDER_TYPES.find((t) => t.value === type)?.label || type} Default`
          : f.name,
    }));
  }

  async function runDiagnostics() {
    setDiagBusy(true);
    setError("");
    try {
      const { res, data } = await fetchJson<Diagnostics>("/api/admin/ai/diagnostics", {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || `Diagnostics failed (HTTP ${res.status})`
        );
      }
      setDiagnostics(data);
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
      const model =
        modelSelectValue === CUSTOM_MODEL ? form.customModel.trim() : form.model;
      if (!model) throw new Error("Select or enter a model");
      const { res, data } = await fetchJson<{ error?: string }>("/api/admin/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          model,
          baseUrl: form.baseUrl || undefined,
          apiKey: form.apiKey || undefined,
          isDefault: form.isDefault,
        }),
      });
      if (!res.ok) throw new Error(data.error || `Create failed (HTTP ${res.status})`);
      setForm((f) => ({ ...f, apiKey: "" }));
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
      const data = await readResponseJson<{ ok?: boolean; message?: string; error?: string }>(r);
      if (!r.ok) {
        alert(data.error || data.message || `Test failed (HTTP ${r.status})`);
        return;
      }
      alert(data.message || (data.ok ? "OK" : "Failed"));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveAssignments() {
    setBusy(true);
    try {
      const { res, data } = await fetchJson<{ error?: string }>("/api/admin/ai/module-assignments", {
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
      if (!res.ok) throw new Error(data.error || `Save assignments failed (HTTP ${res.status})`);
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
        description="Configure Gemini, OpenAI, Claude, Kimi, DeepSeek and custom OpenAI-compatible providers (SUPER_ADMIN)"
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
          <div className="space-y-3 border-t border-card-border pt-3 text-sm">
            <div className="flex flex-wrap gap-3">
              <span
                className={
                  diagnostics.ok
                    ? "text-emerald-600 font-semibold"
                    : "text-red-600 font-semibold"
                }
              >
                {diagnostics.ok ? "Healthy" : "Issues found"}
              </span>
              <span className="text-muted">
                {diagnostics.latencyMs}ms · {new Date(diagnostics.checkedAt).toLocaleString()}
              </span>
            </div>
            <ul className="grid gap-1 sm:grid-cols-2">
              <li>
                Embedding: {diagnostics.embedding.ok ? "OK" : "FAIL"}
                {diagnostics.embedding.ok
                  ? ` (${diagnostics.embedding.dims}d, ${diagnostics.embedding.latencyMs}ms)`
                  : ` — ${diagnostics.embedding.error}`}
              </li>
              <li>
                Chat: {diagnostics.chat.ok ? "OK" : "FAIL"}
                {diagnostics.chat.ok
                  ? ` (${diagnostics.chat.latencyMs}ms)`
                  : ` — ${diagnostics.chat.error}`}
              </li>
              <li>
                KB: {diagnostics.knowledgeBase.ready} ready / {diagnostics.knowledgeBase.total}{" "}
                total
                {diagnostics.knowledgeBase.failed
                  ? ` · ${diagnostics.knowledgeBase.failed} failed`
                  : ""}
              </li>
            </ul>
            {diagnostics.knowledgeBase.byStage.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-muted">
                      <th className="py-1 pe-3">Stage</th>
                      <th className="py-1 pe-3">Ready</th>
                      <th className="py-1 pe-3">Failed</th>
                      <th className="py-1">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostics.knowledgeBase.byStage.map((s) => (
                      <tr key={s.stageId} className="border-t border-card-border/60">
                        <td className="py-1 pe-3">{s.stageName}</td>
                        <td className="py-1 pe-3">{s.ready}</td>
                        <td className="py-1 pe-3">{s.failed}</td>
                        <td className="py-1">{s.pending}</td>
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
                  className={`rounded-lg px-3 py-2 ${
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

      <form
        onSubmit={createProvider}
        className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
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
          onChange={(e) => onTypeChange(e.target.value)}
        >
          {PROVIDER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={modelSelectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === CUSTOM_MODEL) {
              setForm({
                ...form,
                model: form.customModel || "",
                customModel: form.customModel,
              });
            } else {
              setForm({ ...form, model: v, customModel: "" });
            }
          }}
        >
          {modelOptions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
          <option value={CUSTOM_MODEL}>Custom model…</option>
        </select>
        {modelSelectValue === CUSTOM_MODEL ? (
          <input
            className="input"
            placeholder="Custom model id"
            value={form.customModel}
            onChange={(e) =>
              setForm({ ...form, customModel: e.target.value, model: e.target.value })
            }
            required
          />
        ) : null}
        <input
          className="input"
          placeholder="API key"
          type="password"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        />
        <input
          className="input"
          placeholder="Base URL (auto-filled for known providers)"
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
        <p className="sm:col-span-2 lg:col-span-3 text-xs text-muted">
          Claude uses Anthropic keys. Kimi uses Moonshot keys (default{" "}
          <code>api.moonshot.cn/v1</code>). DeepSeek uses DeepSeek keys (default{" "}
          <code>api.deepseek.com/v1</code>). Jina uses keys from{" "}
          <a
            className="underline"
            href="https://jina.ai/api-dashboard/key-manager"
            rel="noopener noreferrer"
            target="_blank"
          >
            jina.ai/api-dashboard/key-manager
          </a>{" "}
          (default <code>api.jina.ai/v1</code>) — assign Jina to EMBEDDING only.
          Keep chat modules on Gemini, OpenAI, DeepSeek, or Claude.
        </p>
        <button
          className="btn btn-primary sm:col-span-2 lg:col-span-3"
          disabled={busy}
          type="submit"
        >
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
                {p.baseUrl ? ` · ${p.baseUrl}` : ""}
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

      <PageHeader
        title="Module assignments"
        description="Route each AI module to a provider. EMBEDDING must be Gemini, OpenAI, or Jina — DeepSeek/Claude/Kimi are chat-only."
      />
      <div className="card space-y-3 p-4">
        {MODULES.map((moduleKey) => {
          const current = assignments.find((a) => a.moduleKey === moduleKey)?.providerId || "";
          const options =
            moduleKey === "EMBEDDING"
              ? providers.filter((p) =>
                  ["GEMINI", "OPENAI", "OPENAI_COMPATIBLE", "JINA"].includes(p.type)
                )
              : providers.filter((p) => p.type !== "JINA");
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
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type} · {p.model})
                  </option>
                ))}
              </select>
              {moduleKey === "EMBEDDING" && options.length === 0 ? (
                <span className="text-xs text-amber-700">
                  Add Gemini, OpenAI, or Jina first — DeepSeek cannot embed.
                </span>
              ) : null}
            </label>
          );
        })}
        <button
          className="btn btn-primary"
          disabled={busy || !providers.length}
          onClick={saveAssignments}
          type="button"
        >
          Save assignments
        </button>
      </div>
    </div>
  );
}
