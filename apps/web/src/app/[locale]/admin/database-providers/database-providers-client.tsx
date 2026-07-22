"use client";

import { Badge, Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Kind = "PRISMA_POSTGRES" | "SUPABASE" | "VPS_POSTGRES" | "LOCAL_CUSTOM";

type Profile = {
  id: string;
  name: string;
  kind: Kind;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTransferTestAt: string | null;
  lastTransferTestOk: boolean | null;
  lastTransferTestSummary: string | null;
  databaseUrlMasked: string;
  directUrlMasked: string;
  hasAccelerateUrl: boolean;
};

type KindMeta = { id: Kind; label: string; hint: string };

type Activation = {
  pending: boolean;
  instructions: string[];
  env: Record<string, string>;
};

const emptyForm = {
  id: "" as string,
  name: "",
  kind: "SUPABASE" as Kind,
  databaseUrl: "",
  directUrl: "",
  accelerateUrl: "",
  notes: "",
};

export function DatabaseProvidersClient() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [kinds, setKinds] = useState<KindMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [current, setCurrent] = useState<{
    databaseUrlMasked: string;
    directUrlMasked: string;
    usesAccelerate: boolean;
    hostHint: string | null;
    hasEnvMirror?: boolean;
  } | null>(null);
  const [envMirror, setEnvMirror] = useState<{
    key: string;
    value: string;
    hint: string;
  } | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [compare, setCompare] = useState<{
    current: Record<string, number>;
    target: Record<string, number>;
    matched: boolean;
  } | null>(null);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    summary: string;
    steps?: { step: string; ok: boolean; detail: string }[];
    phone?: string;
    token?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/database-providers");
    setLoading(false);
    if (!res.ok) {
      toast("Failed to load database providers", "error");
      return;
    }
    const data = await res.json();
    setProfiles(data.config?.profiles || []);
    setActiveId(data.config?.activeProviderId ?? null);
    setPendingId(data.config?.pendingActivationId ?? null);
    setKinds(data.kinds || []);
    setCurrent(data.current || null);
    setEnvMirror(data.envMirror || null);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setForm(emptyForm);
    setEditing(true);
  }

  function openEdit(p: Profile) {
    setForm({
      id: p.id,
      name: p.name,
      kind: p.kind,
      databaseUrl: "",
      directUrl: "",
      accelerateUrl: "",
      notes: p.notes || "",
    });
    setEditing(true);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!form.databaseUrl.trim() || !form.directUrl.trim()) {
      toast("Database URL and Direct URL are required (paste full connection strings)", "error");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/admin/database-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.id || undefined,
        name: form.name,
        kind: form.kind,
        databaseUrl: form.databaseUrl,
        directUrl: form.directUrl,
        accelerateUrl: form.accelerateUrl || null,
        notes: form.notes || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Failed to save provider", "error");
      return;
    }
    toast(form.id ? "Provider updated" : "Provider saved");
    setEditing(false);
    void load();
  }

  async function removeProfile(p: Profile) {
    if (!confirm(`Delete provider "${p.name}"? Connection secrets will be removed.`)) return;
    const res = await fetch(`/api/admin/database-providers?id=${encodeURIComponent(p.id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast("Delete failed", "error");
      return;
    }
    toast("Provider deleted");
    void load();
  }

  async function testProfile(p: Profile) {
    setBusy(true);
    const res = await fetch("/api/admin/database-providers/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: p.id }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      toast(data.error || "Connection failed", "error");
      void load();
      return;
    }
    toast(
      data.schemaReady === false
        ? `Connected · ${data.tableCount} tables · schema incomplete — click Apply schema`
        : `OK · ${data.latencyMs}ms · ${data.tableCount} tables · users=${data.userCount}`
    );
    void load();
  }

  async function exportBackup() {
    setBusy(true);
    const res = await fetch("/api/admin/database-providers/export");
    setBusy(false);
    if (!res.ok) {
      toast("Export failed", "error");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ulearn-db-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup downloaded — keep this file safe");
  }

  async function importFile(file: File, targetProviderId?: string, wipeTarget?: boolean) {
    setBusy(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const res = await fetch("/api/admin/database-providers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup, targetProviderId, wipeTarget }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Import failed", "error");
        return;
      }
      toast(
        `Imported ${data.totalImported} rows into ${data.target}${
          data.errors?.length ? ` (${data.errors.length} model warnings)` : ""
        }`
      );
    } catch {
      toast("Invalid backup JSON", "error");
    } finally {
      setBusy(false);
    }
  }

  async function transferTest(p: Profile) {
    setBusy(true);
    setProbeResult(null);
    const res = await fetch("/api/admin/database-providers/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "transfer_test", providerId: p.id }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    const probe = data.probe || data;
    if (!res.ok || !probe?.ok) {
      setProbeResult({
        ok: false,
        summary: data.error || probe?.summary || "Transfer test failed",
        steps: probe?.steps,
      });
      toast(data.error || "Transfer test failed — do not migrate yet", "error");
      void load();
      return;
    }
    setProbeResult({
      ok: true,
      summary: probe.summary,
      steps: probe.steps,
      phone: probe.phone,
      token: probe.token,
    });
    toast("Transfer test passed — safe to migrate");
    void load();
  }

  async function applySchema(p: Profile) {
    if (
      !confirm(
        `Apply U Learn Prisma schema to "${p.name}"?\n\nThis runs prisma migrate deploy on the target (creates Country, User, …). Safe on empty Supabase; do not run on a DB that already has conflicting tables.`
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch("/api/admin/database-providers/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply_schema", providerId: p.id }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      toast(data.error || data.message || "Apply schema failed", "error");
      return;
    }
    toast(data.message || "Schema applied — run Transfer test next");
    void load();
  }

  function canMigrate(p: Profile) {
    if (!p.lastTransferTestOk || !p.lastTransferTestAt) return false;
    const age = Date.now() - new Date(p.lastTransferTestAt).getTime();
    return age >= 0 && age < 24 * 60 * 60 * 1000;
  }

  async function migrate(p: Profile) {
    if (!canMigrate(p)) {
      toast("Run Transfer test first and wait for a pass (valid 24h)", "error");
      return;
    }
    const wipe = confirm(
      `Migrate ALL current data → "${p.name}"?\n\nOK = copy data (skip duplicates)\nYou will be asked next about wiping the target first.`
    );
    if (!wipe) return;
    const wipeTarget = confirm(
      "Wipe target database before import?\n\nChoose OK only if the target should become an exact copy (destroys existing rows on target)."
    );

    setBusy(true);
    setActivation(null);
    setCompare(null);
    const res = await fetch("/api/admin/database-providers/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "migrate",
        providerId: p.id,
        wipeTarget,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      toast(data.error || "Migrate failed", "error");
      if (data.probe) setProbeResult(data.probe);
      return;
    }
    setActivation(data.activation);
    if (data.transferProbe) setProbeResult(data.transferProbe);
    toast(
      `Copied ${data.import?.totalImported ?? 0} rows (source had ${data.sourceTotal}). Set env vars to finish.`
    );
    void load();
  }

  async function compareTo(p: Profile) {
    setBusy(true);
    const res = await fetch("/api/admin/database-providers/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "compare", providerId: p.id }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || "Compare failed", "error");
      return;
    }
    setCompare(data);
    toast(data.matched ? "Row counts match" : "Row counts differ — review before switching");
  }

  async function confirmActivated(p: Profile) {
    if (
      !confirm(
        `Confirm the app is now running on "${p.name}"?\nOnly click after you updated env vars and redeployed.`
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch("/api/admin/database-providers/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", providerId: p.id }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Confirm failed — run Transfer test first if needed", "error");
      return;
    }
    toast("Marked as active provider");
    setActivation(null);
    void load();
  }

  function copyEnv(env: Record<string, string>) {
    const text = Object.entries(env)
      .map(([k, v]) => `${k}="${v}"`)
      .join("\n");
    void navigator.clipboard.writeText(text);
    toast("Env vars copied — paste into Vercel / .env then redeploy");
  }

  function copyProvidersEnvMirror() {
    if (!envMirror?.value) {
      toast("No providers mirror yet — save a provider first", "error");
      return;
    }
    void navigator.clipboard.writeText(`${envMirror.key}="${envMirror.value}"`);
    toast("DB_PROVIDERS_CONFIG copied — paste into Vercel env, then redeploy");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Database Providers"
        description="Manage Prisma Postgres, Supabase, VPS, or custom Postgres hosts. Export/import keeps data safe when switching."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void exportBackup()}>
              Export backup
            </Button>
            <Button
              variant="outline"
              disabled={busy || !envMirror?.value}
              onClick={copyProvidersEnvMirror}
              title="Keeps all provider profiles after switching DB / redeploying"
            >
              Copy providers env
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => document.getElementById("db-import-current")?.click()}
            >
              Import backup…
            </Button>
            <input
              id="db-import-current"
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
            <Button onClick={openCreate}>+ Add provider</Button>
          </div>
        }
      />

      <Card className="space-y-2 p-4 text-sm">
        <p className="font-semibold">Currently connected</p>
        {current ? (
          <div className="space-y-1 text-muted">
            <p>
              Host: <span className="text-foreground">{current.hostHint || "—"}</span>
              {current.usesAccelerate ? (
                <Badge status="ACTIVE">Accelerate / pool</Badge>
              ) : (
                <Badge status="PENDING">Direct / pooled Postgres</Badge>
              )}
            </p>
            <p className="break-all font-mono text-xs">DATABASE_URL {current.databaseUrlMasked}</p>
            <p className="break-all font-mono text-xs">DIRECT_URL {current.directUrlMasked}</p>
          </div>
        ) : (
          <p className="text-muted">Loading…</p>
        )}
        <p className="text-xs text-muted">
          Safe switch: Export backup → Test → Apply schema (if empty) → Transfer test → Migrate →
          set env + <span className="text-foreground">DB_PROVIDERS_CONFIG</span> + redeploy →
          Confirm. Provider list is stored in the DB and mirrored to Vercel env so you can switch
          back to a previous host. Use <span className="text-foreground">Copy providers env</span>{" "}
          after saving profiles.
          {current?.hasEnvMirror === false && (
            <span className="block mt-1 text-amber-400">
              DB_PROVIDERS_CONFIG is not set on this deployment — previous providers may disappear
              after a DB switch until you paste the mirror into Vercel.
            </span>
          )}
        </p>
      </Card>

      {probeResult && (
        <Card className="space-y-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">Transfer test result</p>
            {probeResult.ok ? (
              <Badge status="ACTIVE">Passed</Badge>
            ) : (
              <Badge status="SUSPENDED">Failed</Badge>
            )}
          </div>
          <p className="text-muted">{probeResult.summary}</p>
          {probeResult.phone && (
            <p className="font-mono text-xs text-muted">
              Tester phone {probeResult.phone}
              {probeResult.token ? ` · token ${probeResult.token}` : ""}
            </p>
          )}
          {probeResult.steps && probeResult.steps.length > 0 && (
            <ul className="space-y-1 text-xs">
              {probeResult.steps.map((s, i) => (
                <li key={`${s.step}-${i}`} className="flex gap-2">
                  <span className={s.ok ? "text-emerald-400" : "text-amber-400"}>
                    {s.ok ? "✓" : "✗"}
                  </span>
                  <span>
                    <span className="text-foreground">{s.step}</span> — {s.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {pendingId && (
        <Card className="border-accent/40 bg-accent/5 p-4 text-sm">
          <p className="font-semibold">Pending activation</p>
          <p className="text-muted">
            Data was copied to a target provider. Update env + redeploy, then confirm below.
          </p>
        </Card>
      )}

      {activation && (
        <Card className="space-y-3 p-4">
          <p className="font-semibold">Activation — set these env vars</p>
          <ol className="list-decimal space-y-1 ps-5 text-sm text-muted">
            {activation.instructions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 text-xs">
            {Object.entries(activation.env)
              .map(([k, v]) => `${k}="…"`)
              .join("\n")}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => copyEnv(activation.env)}>Copy full env values</Button>
          </div>
        </Card>
      )}

      {compare && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-xs uppercase text-muted">
                <th className="p-3 text-start">Table</th>
                <th className="p-3 text-start">Current</th>
                <th className="p-3 text-start">Target</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(compare.current).map((k) => (
                <tr key={k} className="border-b border-card-border/40">
                  <td className="p-3">{k}</td>
                  <td className="p-3">{compare.current[k]}</td>
                  <td className="p-3">{compare.target[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-3 text-sm">
            {compare.matched ? (
              <span className="text-emerald-400">Counts match</span>
            ) : (
              <span className="text-amber-400">Counts differ — investigate before activating</span>
            )}
          </p>
        </Card>
      )}

      {loading ? (
        <SkeletonRows rows={4} />
      ) : profiles.length === 0 ? (
        <EmptyState
          title="No providers saved"
          hint="Add Supabase, Prisma Postgres, VPS, or a local Postgres connection."
        />
      ) : (
        <div className="stagger space-y-3">
          {profiles.map((p) => (
            <Card key={p.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{p.name}</p>
                    <Badge status="ACTIVE">{p.kind}</Badge>
                    {activeId === p.id && <Badge status="ACTIVE">Active</Badge>}
                    {pendingId === p.id && <Badge status="PENDING">Pending</Badge>}
                    {p.lastTestOk === true && <Badge status="ACTIVE">Conn OK</Badge>}
                    {p.lastTestOk === false && <Badge status="SUSPENDED">Conn failed</Badge>}
                    {canMigrate(p) ? (
                      <Badge status="ACTIVE">Transfer OK</Badge>
                    ) : p.lastTransferTestOk === false ? (
                      <Badge status="SUSPENDED">Transfer failed</Badge>
                    ) : (
                      <Badge status="PENDING">Transfer test required</Badge>
                    )}
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-muted">
                    DB {p.databaseUrlMasked}
                  </p>
                  <p className="break-all font-mono text-xs text-muted">
                    Direct {p.directUrlMasked}
                  </p>
                  {p.lastTransferTestSummary && (
                    <p className="mt-1 text-xs text-muted">{p.lastTransferTestSummary}</p>
                  )}
                  {p.notes && <p className="mt-1 text-sm text-muted">{p.notes}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="!py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => void testProfile(p)}
                >
                  Test connection
                </Button>
                <Button
                  variant="outline"
                  className="!py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => void applySchema(p)}
                >
                  Apply schema
                </Button>
                <Button
                  variant="outline"
                  className="!py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => void transferTest(p)}
                >
                  Transfer test
                </Button>
                <Button
                  variant="outline"
                  className="!py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => void compareTo(p)}
                >
                  Compare counts
                </Button>
                <Button
                  className="!py-1.5 text-xs"
                  disabled={busy || !canMigrate(p)}
                  title={
                    canMigrate(p)
                      ? "Copy all data to this provider"
                      : "Run Transfer test first (pass is valid 24h)"
                  }
                  onClick={() => void migrate(p)}
                >
                  Migrate data here
                </Button>
                <Button
                  variant="outline"
                  className="!py-1.5 text-xs"
                  disabled={busy}
                  onClick={() =>
                    document.getElementById(`db-import-target-${p.id}`)?.click()
                  }
                >
                  Import file →
                </Button>
                <input
                  id={`db-import-target-${p.id}`}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const wipe = confirm("Wipe this target before import?");
                    void importFile(f, p.id, wipe);
                    e.target.value = "";
                  }}
                />
                {(pendingId === p.id || activeId !== p.id) && (
                  <Button
                    variant="outline"
                    className="!py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => void confirmActivated(p)}
                  >
                    Confirm activated
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="!py-1.5 text-xs"
                  onClick={() => openEdit(p)}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  className="!py-1.5 text-xs"
                  onClick={() => void removeProfile(p)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {kinds.length > 0 && (
        <Card className="space-y-2 p-4 text-sm text-muted">
          <p className="font-semibold text-foreground">Provider types</p>
          {kinds.map((k) => (
            <p key={k.id}>
              <span className="text-foreground">{k.label}</span> — {k.hint}
            </p>
          ))}
        </Card>
      )}

      {editing && (
        <Modal
          open
          onClose={() => setEditing(false)}
          title={form.id ? "Edit database provider" : "Add database provider"}
        >
          <form onSubmit={saveProfile} className="space-y-4">
            <Input
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Production Supabase"
              required
            />
            <Select
              label="Kind"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
            >
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
            <Input
              label="DATABASE_URL (app runtime — postgres or prisma://)"
              value={form.databaseUrl}
              onChange={(e) => setForm({ ...form, databaseUrl: e.target.value })}
              placeholder="postgresql://… or prisma://…"
              required
            />
            <Input
              label="DIRECT_DATABASE_URL (required for test / migrate — postgresql only)"
              value={form.directUrl}
              onChange={(e) => setForm({ ...form, directUrl: e.target.value })}
              placeholder="postgresql://… (Supabase: direct or session URI, not prisma://)"
              required
            />
            <p className="text-xs text-muted">
              Test / transfer / migrate use the direct Postgres URL. For Supabase: Database →
              Connection string → URI (session or direct). If the password has{" "}
              <code className="text-foreground">@ : # / ?</code> or spaces, URL-encode it (
              <code className="text-foreground">@</code> →{" "}
              <code className="text-foreground">%40</code>). Do not put{" "}
              <code className="text-foreground">prisma://</code> in the direct field.
            </p>
            <Input
              label="PRISMA_ACCELERATE_URL (optional)"
              value={form.accelerateUrl}
              onChange={(e) => setForm({ ...form, accelerateUrl: e.target.value })}
              placeholder="prisma://accelerate.prisma-data.net/?api_key=…"
            />
            <Input
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            {form.id && (
              <p className="text-xs text-muted">
                Editing replaces stored secrets — paste full URLs again to update.
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Save provider"}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
