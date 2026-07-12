"use client";

import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Request = {
  id: string;
  user: { fullLegalName: string | null; phone: string };
  package: { nameEn: string; price: string; currency?: string };
};

type Package = {
  id: string;
  type: string;
  nameEn: string;
  price: string;
  currency: string;
  deviceLimit: number;
  isActive: boolean;
  country?: { nameEn: string } | null;
  subject?: { nameEn: string } | null;
  stage?: { nameEn: string } | null;
  _count: { subscriptions: number };
};

type Code = {
  id: string;
  code: string;
  packageName?: string | null;
  usedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
};

type Country = { id: string; nameEn: string };

export function SubscriptionsClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState("requests");
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [showCreatePkg, setShowCreatePkg] = useState(false);
  const [showGenCodes, setShowGenCodes] = useState(false);

  const loadRequests = useCallback(async () => {
    const res = await fetch("/api/admin/subscriptions/requests");
    if (res.ok) setRequests((await res.json()).requests ?? []);
  }, []);

  const loadPackages = useCallback(async () => {
    const res = await fetch("/api/admin/packages");
    if (res.ok) setPackages((await res.json()).packages);
  }, []);

  const loadCodes = useCallback(async () => {
    const res = await fetch("/api/admin/codes");
    if (res.ok) setCodes((await res.json()).codes);
  }, []);

  useEffect(() => {
    loadRequests();
    fetch("/api/countries").then(async (r) => {
      if (r.ok) setCountries((await r.json()).countries);
    });
  }, [loadRequests]);

  useEffect(() => {
    if (tab === "packages" && packages === null) loadPackages();
    if (tab === "codes" && codes === null) loadCodes();
  }, [tab, packages, codes, loadPackages, loadCodes]);

  async function approve(requestId: string) {
    const res = await fetch("/api/admin/subscriptions/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, sendAutomatically: true }),
    });
    if (res.ok) {
      const data = await res.json();
      toast(`Code ${data.code?.code} generated and sent to the user`);
      loadRequests();
      setCodes(null);
    } else {
      toast("Failed to generate code", "error");
    }
  }

  async function rejectRequest(requestId: string) {
    const notes = window.prompt("Reason for declining (sent to the student):") ?? undefined;
    const res = await fetch("/api/admin/subscriptions/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action: "reject", notes }),
    });
    if (res.ok) {
      toast("Request declined");
      loadRequests();
    } else {
      toast("Failed to decline request", "error");
    }
  }

  async function togglePackage(pkg: Package) {
    const res = await fetch(`/api/admin/packages/${pkg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !pkg.isActive }),
    });
    if (res.ok) {
      toast(pkg.isActive ? "Package deactivated" : "Package activated");
      loadPackages();
    }
  }

  async function deletePackage(pkg: Package) {
    if (!confirm(`Delete package "${pkg.nameEn}"?`)) return;
    const res = await fetch(`/api/admin/packages/${pkg.id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Package deleted");
      loadPackages();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <a href="/api/admin/subscriptions/export">
          <Button variant="outline">Export Excel</Button>
        </a>
      </div>
      <Tabs
        tabs={[
          { id: "requests", label: "Requests" },
          { id: "packages", label: "Packages" },
          { id: "codes", label: "Activation Codes" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ── Requests ── */}
      {tab === "requests" &&
        (requests === null ? (
          <SkeletonRows rows={4} />
        ) : requests.length === 0 ? (
          <EmptyState title="No pending requests" hint="Student activation requests will appear here." />
        ) : (
          <div className="stagger space-y-3">
            {requests.map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{r.user.fullLegalName ?? "—"}</p>
                  <p className="text-sm text-muted" dir="ltr">{r.user.phone}</p>
                </div>
                <div className="text-sm">
                  <span className="badge badge-free">{r.package.nameEn}</span>
                  <span className="ms-2 text-muted">{r.package.price} {r.package.currency ?? "IQD"}</span>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => approve(r.id)}>Generate & Send Code</Button>
                  <Button variant="danger" onClick={() => rejectRequest(r.id)}>Decline</Button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {/* ── Packages ── */}
      {tab === "packages" && (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setShowCreatePkg(true)}>+ New Package</Button>
          </div>
          {packages === null ? (
            <SkeletonRows rows={4} />
          ) : packages.length === 0 ? (
            <EmptyState title="No packages yet" hint="Create a package so students can subscribe." />
          ) : (
            <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {packages.map((p) => (
                <Card key={p.id} className="card-hover flex flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{p.nameEn}</p>
                    <Badge status={p.isActive ? "ACTIVE" : "SUSPENDED"}>
                      {p.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-2xl font-bold glow-text">
                    {Number(p.price).toLocaleString()} <span className="text-sm">{p.currency}</span>
                  </p>
                  <div className="mt-3 space-y-1 text-sm text-muted">
                    <p>{p.type === "FULL_STAGE" ? `Full stage: ${p.stage?.nameEn ?? "—"}` : `Subject: ${p.subject?.nameEn ?? "—"}`}</p>
                    <p>{p.country?.nameEn} · {p.deviceLimit} device{p.deviceLimit > 1 ? "s" : ""}</p>
                    <p>{p._count.subscriptions} active subscriptions</p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" className="flex-1 !py-1.5 text-xs" onClick={() => togglePackage(p)}>
                      {p.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button variant="danger" className="!py-1.5 text-xs" onClick={() => deletePackage(p)}>
                      Delete
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Codes ── */}
      {tab === "codes" && (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setShowGenCodes(true)}>+ Generate Codes</Button>
          </div>
          {codes === null ? (
            <SkeletonRows rows={6} />
          ) : codes.length === 0 ? (
            <EmptyState title="No activation codes" />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border text-xs uppercase tracking-wide text-muted">
                    <th className="p-3 text-start">Code</th>
                    <th className="p-3 text-start">Package</th>
                    <th className="p-3 text-start">Status</th>
                    <th className="p-3 text-start">Expires</th>
                    <th className="p-3 text-start">Created</th>
                  </tr>
                </thead>
                <tbody className="stagger">
                  {codes.map((c) => (
                    <tr key={c.id} className="border-b border-card-border/40 transition hover:bg-white/[0.02]">
                      <td className="p-3">
                        <button
                          className="font-mono font-semibold text-accent transition hover:opacity-70"
                          title="Copy"
                          onClick={() => {
                            navigator.clipboard.writeText(c.code);
                            toast("Code copied");
                          }}
                        >
                          {c.code}
                        </button>
                      </td>
                      <td className="p-3 text-muted">{c.packageName ?? "—"}</td>
                      <td className="p-3">
                        <Badge status={c.usedAt ? "SUSPENDED" : "ACTIVE"}>
                          {c.usedAt ? "Used" : "Available"}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted">
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="p-3 text-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showCreatePkg && (
        <CreatePackageModal
          countries={countries}
          onClose={() => setShowCreatePkg(false)}
          onDone={() => { setShowCreatePkg(false); loadPackages(); }}
          toast={toast}
        />
      )}
      {showGenCodes && (
        <GenerateCodesModal
          onClose={() => setShowGenCodes(false)}
          onDone={() => { setShowGenCodes(false); loadCodes(); }}
          toast={toast}
        />
      )}
    </div>
  );
}

/* ── Create package modal ──────────────────────────── */

type Names = { nameEn: string; nameAr: string; nameKu: string; nameTr: string };

function CreatePackageModal({ countries, onClose, onDone, toast }: {
  countries: Country[];
  onClose: () => void;
  onDone: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [saving, setSaving] = useState(false);
  const [names, setNames] = useState<Names>({ nameEn: "", nameAr: "", nameKu: "", nameTr: "" });
  const [countryId, setCountryId] = useState(countries[0]?.id ?? "");
  const [type, setType] = useState("SINGLE_SUBJECT");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("IQD");
  const [deviceLimit, setDeviceLimit] = useState("1");
  const [durationDays, setDurationDays] = useState("30");
  const [targets, setTargets] = useState<{ stages: { id: string; nameEn: string }[]; subjects: { id: string; nameEn: string }[] }>({ stages: [], subjects: [] });
  const [stageId, setStageId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  useEffect(() => {
    if (!countryId) return;
    fetch(`/api/admin/courses/tree?countryId=${countryId}`).then(async (r) => {
      if (!r.ok) return;
      const { stages } = await r.json();
      setTargets({
        stages: stages.map((s: { id: string; nameEn: string }) => ({ id: s.id, nameEn: s.nameEn })),
        subjects: stages.flatMap((s: { subjects: { id: string; nameEn: string }[] }) =>
          s.subjects.map((sub) => ({ id: sub.id, nameEn: sub.nameEn }))
        ),
      });
    });
  }, [countryId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...names,
        countryId,
        type,
        price: Number(price),
        currency,
        deviceLimit: Number(deviceLimit),
        durationDays:
          type === "AI_CREATIVE" && durationDays
            ? Number(durationDays)
            : undefined,
        stageId: type === "FULL_STAGE" ? stageId : undefined,
        subjectId: type === "SINGLE_SUBJECT" ? subjectId : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) { toast("Package created"); onDone(); }
    else toast("Failed to create package", "error");
  }

  return (
    <Modal open onClose={onClose} title="New Subscription Package">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name (English)" value={names.nameEn} onChange={(e) => setNames({ ...names, nameEn: e.target.value })} required />
          <Input label="الاسم (العربية)" dir="rtl" value={names.nameAr} onChange={(e) => setNames({ ...names, nameAr: e.target.value })} />
          <Input label="ناو (کوردی)" dir="rtl" value={names.nameKu} onChange={(e) => setNames({ ...names, nameKu: e.target.value })} />
          <Input label="İsim (Türkçe)" value={names.nameTr} onChange={(e) => setNames({ ...names, nameTr: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Country" value={countryId} onChange={(e) => setCountryId(e.target.value)} required>
            {countries.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
          </Select>
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="SINGLE_SUBJECT">Single subject</option>
            <option value="FULL_STAGE">Full stage</option>
            <option value="CERTIFICATE_PROGRAM">Certificate program</option>
            <option value="AI_CREATIVE">AI Creative Studio</option>
          </Select>
          {type === "AI_CREATIVE" ? (
            <Input
              label="Duration (days)"
              type="number"
              min="1"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              required
            />
          ) : type === "SINGLE_SUBJECT" ? (
            <Select label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
              <option value="">Select…</option>
              {targets.subjects.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
            </Select>
          ) : type === "FULL_STAGE" ? (
            <Select label="Stage" value={stageId} onChange={(e) => setStageId(e.target.value)} required>
              <option value="">Select…</option>
              {targets.stages.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
            </Select>
          ) : null}
          <Input label="Price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
          <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="IQD">IQD</option>
            <option value="USD">USD</option>
            <option value="TRY">TRY</option>
          </Select>
          <Input label="Device limit" type="number" min="1" max="5" value={deviceLimit} onChange={(e) => setDeviceLimit(e.target.value)} />
        </div>
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Creating…" : "Create Package"}</Button>
      </form>
    </Modal>
  );
}

/* ── Generate codes modal ──────────────────────────── */

function GenerateCodesModal({ onClose, onDone, toast }: {
  onClose: () => void;
  onDone: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [packages, setPackages] = useState<{ id: string; nameEn: string }[]>([]);
  const [packageId, setPackageId] = useState("");
  const [count, setCount] = useState("1");
  const [days, setDays] = useState("30");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/packages").then(async (r) => {
      if (r.ok) {
        const { packages } = await r.json();
        setPackages(packages);
        if (packages[0]) setPackageId(packages[0].id);
      }
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/admin/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId, count: Number(count), expiresInDays: Number(days) }),
    });
    setSaving(false);
    if (res.ok) {
      const { codes } = await res.json();
      toast(`${codes.length} code${codes.length > 1 ? "s" : ""} generated`);
      onDone();
    } else {
      toast("Failed to generate codes", "error");
    }
  }

  return (
    <Modal open onClose={onClose} title="Generate Activation Codes">
      <form onSubmit={submit} className="space-y-4">
        <Select label="Package" value={packageId} onChange={(e) => setPackageId(e.target.value)} required>
          {packages.map((p) => <option key={p.id} value={p.id}>{p.nameEn}</option>)}
        </Select>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="How many codes" type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} />
          <Input label="Valid for (days)" type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <Button type="submit" disabled={saving || !packageId} className="w-full">
          {saving ? "Generating…" : "Generate"}
        </Button>
      </form>
    </Modal>
  );
}
