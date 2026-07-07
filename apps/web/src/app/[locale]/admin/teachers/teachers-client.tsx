"use client";

import { Badge, Button, Input, Select } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Teacher = {
  id: string;
  fullLegalName: string;
  phone: string;
  email?: string | null;
  status: string;
  createdAt: string;
  country?: { nameEn: string } | null;
  teacherProfile?: {
    id: string;
    level: string;
    levelSetByAdmin: boolean;
    specializations: string[];
    subjects: { subject: { id: string; nameEn: string } }[];
    _count: { ratings: number; complaints: number };
  } | null;
};

const LEVELS = ["NEEDS_IMPROVEMENT", "GOOD", "EXCELLENT", "MASTER"] as const;

const LEVEL_STYLE: Record<string, string> = {
  MASTER: "bg-accent/20 text-accent",
  EXCELLENT: "bg-success/20 text-success",
  GOOD: "bg-warning/20 text-warning",
  NEEDS_IMPROVEMENT: "bg-danger/20 text-danger",
};

type Country = { id: string; nameEn: string };

export function TeachersClient() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [tRes, cRes] = await Promise.all([
      fetch("/api/admin/teachers"),
      fetch("/api/countries"),
    ]);
    if (tRes.ok) setTeachers((await tRes.json()).teachers);
    if (cRes.ok) setCountries((await cRes.json()).countries);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)}>+ Add Teacher</Button>
      </div>

      {loading ? (
        <SkeletonRows rows={4} />
      ) : teachers.length === 0 ? (
        <EmptyState title="No teachers yet" hint="Add your first teacher to assign subjects and answer student questions." />
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teachers.map((t) => (
            <div key={t.id} className="card card-hover p-5">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.fullLegalName}</p>
                  <p className="text-sm text-muted" dir="ltr">{t.phone}</p>
                </div>
                <Badge status={t.status}>{t.status}</Badge>
              </div>
              <div className="space-y-1.5 text-sm text-muted">
                {t.country && <p>Country: {t.country.nameEn}</p>}
                {t.teacherProfile?.specializations?.length ? (
                  <p>Specializations: {t.teacherProfile.specializations.join(", ")}</p>
                ) : null}
                {t.teacherProfile?.subjects?.length ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {t.teacherProfile.subjects.map((s) => (
                      <span key={s.subject.id} className="badge badge-free">{s.subject.nameEn}</span>
                    ))}
                  </div>
                ) : null}
                <p className="pt-1 text-xs">
                  {t.teacherProfile?._count.ratings ?? 0} ratings · {t.teacherProfile?._count.complaints ?? 0} complaints
                </p>
              </div>
              {t.teacherProfile && (
                <LevelControl
                  profileId={t.teacherProfile.id}
                  level={t.teacherProfile.level}
                  pinned={t.teacherProfile.levelSetByAdmin}
                  onChanged={load}
                  toast={toast}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTeacherModal
          countries={countries}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); load(); }}
          toast={toast}
        />
      )}
    </div>
  );
}

/**
 * Teacher level control. The level normally follows student evaluations;
 * choosing a level here pins it, and "Auto" returns it to rating-driven.
 */
function LevelControl({ profileId, level, pinned, onChanged, toast }: {
  profileId: string;
  level: string;
  pinned: boolean;
  onChanged: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [busy, setBusy] = useState(false);

  async function set(body: { level?: string; auto?: boolean }) {
    setBusy(true);
    const res = await fetch(`/api/admin/teachers/${profileId}/level`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      toast("Teacher level updated");
      onChanged();
    } else {
      toast("Failed to update level", "error");
    }
  }

  return (
    <div className="mt-3 border-t border-card-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL_STYLE[level] ?? ""}`}
        >
          {level.replace(/_/g, " ")}
          {pinned && " (pinned)"}
        </span>
        <div className="flex items-center gap-1.5">
          <select
            className="input !w-auto !py-1 text-xs"
            value={level}
            disabled={busy}
            onChange={(e) => set({ level: e.target.value })}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {pinned && (
            <button
              className="text-xs text-accent hover:underline"
              disabled={busy}
              onClick={() => set({ auto: true })}
            >
              Auto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateTeacherModal({ countries, onClose, onDone, toast }: {
  countries: Country[];
  onClose: () => void;
  onDone: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fullLegalName: "",
    phone: "",
    email: "",
    countryId: "",
    specializations: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/admin/teachers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullLegalName: form.fullLegalName,
        phone: form.phone,
        email: form.email || undefined,
        countryId: form.countryId || undefined,
        specializations: form.specializations
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast("Teacher created");
      onDone();
    } else {
      const err = await res.json().catch(() => null);
      toast(err?.error ?? "Failed to create teacher", "error");
    }
  }

  return (
    <Modal open onClose={onClose} title="Add Teacher">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Full legal name" value={form.fullLegalName} onChange={(e) => setForm({ ...form, fullLegalName: e.target.value })} required />
        <Input label="WhatsApp phone (with country code)" dir="ltr" placeholder="+9647501234567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
        <Input label="Email (optional)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Select label="Country" value={form.countryId} onChange={(e) => setForm({ ...form, countryId: e.target.value })}>
          <option value="">—</option>
          {countries.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
        </Select>
        <Input label="Specializations (comma separated)" placeholder="Math, Physics" value={form.specializations} onChange={(e) => setForm({ ...form, specializations: e.target.value })} />
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Creating…" : "Create Teacher"}</Button>
      </form>
    </Modal>
  );
}
