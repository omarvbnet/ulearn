"use client";

import { Button, Card, Input, Select } from "@/components/ui";
import { SkeletonRows, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type SettingsMap = Record<string, unknown>;

type Clip = {
  id: string;
  locale: string;
  type: string;
  fileUrl: string | null;
  country: { nameEn: string; code: string } | null;
};

/** Converts "MM-DD" to the next occurrence of that date (this year or next). */
function nextOccurrence(monthDay: string): Date | null {
  const m = monthDay.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, mm, dd] = m;
  const now = new Date();
  let candidate = new Date(now.getFullYear(), Number(mm) - 1, Number(dd), 23, 59, 59);
  if (candidate <= now) {
    candidate = new Date(now.getFullYear() + 1, Number(mm) - 1, Number(dd), 23, 59, 59);
  }
  return candidate;
}

export function SettingsClient() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expiryDate, setExpiryDate] = useState("07-15");
  const [excludeCertUsers, setExcludeCertUsers] = useState(true);
  const [inactivityDays, setInactivityDays] = useState("30");
  const [otpExpiryMin, setOtpExpiryMin] = useState("5");

  useEffect(() => {
    fetch("/api/admin/settings").then(async (r) => {
      if (r.ok) {
        const { settings } = await r.json();
        const map: SettingsMap = {};
        for (const s of settings) map[s.key] = s.value;
        if (typeof map.global_subscription_expiry === "string") {
          const d = new Date(map.global_subscription_expiry);
          if (!Number.isNaN(d.getTime())) {
            setExpiryDate(
              `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
            );
          }
        }
        if (map.exclude_certificate_from_global_expiry !== undefined)
          setExcludeCertUsers(Boolean(map.exclude_certificate_from_global_expiry));
        if (map.inactivity_days) setInactivityDays(String(map.inactivity_days));
        if (map.otp_expiry_minutes) setOtpExpiryMin(String(map.otp_expiry_minutes));
      }
      setLoading(false);
    });
  }, []);

  async function save(key: string, value: unknown, label: string) {
    setSaving(key);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    setSaving(null);
    if (res.ok) toast(`${label} saved`);
    else toast(`Failed to save ${label}`, "error");
  }

  if (loading) return <SkeletonRows rows={3} />;

  return (
    <div className="stagger grid gap-5 md:grid-cols-2">
      <Card className="space-y-4">
        <div>
          <h3 className="font-semibold">Subscription Expiry</h3>
          <p className="mt-1 text-sm text-muted">
            All student subscriptions expire on this date every year (default 15 July).
          </p>
        </div>
        <Input
          label="Expiry date (MM-DD)"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          pattern="\d{2}-\d{2}"
          placeholder="07-15"
        />
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={excludeCertUsers}
            onChange={(e) => setExcludeCertUsers(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Exclude experience-certificate users from yearly expiry
        </label>
        <Button
          disabled={saving === "expiry"}
          onClick={async () => {
            const next = nextOccurrence(expiryDate);
            if (!next) {
              toast("Use MM-DD format, e.g. 07-15", "error");
              return;
            }
            await save("global_subscription_expiry", next.toISOString(), "Expiry date");
            await save(
              "exclude_certificate_from_global_expiry",
              excludeCertUsers,
              "Certificate exclusion"
            );
          }}
        >
          Save Expiry Settings
        </Button>
      </Card>

      <Card className="space-y-4">
        <div>
          <h3 className="font-semibold">Inactive Users</h3>
          <p className="mt-1 text-sm text-muted">
            Users with no activity for this many days are marked INACTIVE and notified by the
            daily cron job.
          </p>
        </div>
        <Input
          label="Inactivity period (days)"
          type="number"
          min="7"
          value={inactivityDays}
          onChange={(e) => setInactivityDays(e.target.value)}
        />
        <Button
          disabled={saving === "inactivity_days"}
          onClick={() => save("inactivity_days", Number(inactivityDays), "Inactivity period")}
        >
          Save
        </Button>
      </Card>

      <Card className="space-y-4">
        <div>
          <h3 className="font-semibold">OTP</h3>
          <p className="mt-1 text-sm text-muted">WhatsApp OTP code lifetime in minutes.</p>
        </div>
        <Input
          label="OTP expiry (minutes)"
          type="number"
          min="1"
          max="30"
          value={otpExpiryMin}
          onChange={(e) => setOtpExpiryMin(e.target.value)}
        />
        <Button
          disabled={saving === "otp_expiry_minutes"}
          onClick={() => save("otp_expiry_minutes", Number(otpExpiryMin), "OTP expiry")}
        >
          Save
        </Button>
      </Card>

      <DeductionsCard />

      <IntroOutroCard />
    </div>
  );
}

/**
 * Platform revenue deduction (%) per teacher level.
 * Teachers at "Needs improvement" cannot sell at all, so no rate is needed.
 */
function DeductionsCard() {
  const { toast } = useToast();
  const [good, setGood] = useState("30");
  const [excellent, setExcellent] = useState("20");
  const [master, setMaster] = useState("10");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings").then(async (r) => {
      if (r.ok) {
        const { settings } = await r.json();
        for (const s of settings) {
          if (s.key === "deduction_good") setGood(String(s.value));
          if (s.key === "deduction_excellent") setExcellent(String(s.value));
          if (s.key === "deduction_master") setMaster(String(s.value));
        }
      }
      setLoaded(true);
    });
  }, []);

  async function saveAll() {
    const entries: Array<[string, string]> = [
      ["deduction_good", good],
      ["deduction_excellent", excellent],
      ["deduction_master", master],
    ];
    for (const [, v] of entries) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        toast("Percentages must be between 0 and 100", "error");
        return;
      }
    }
    setSaving(true);
    for (const [key, v] of entries) {
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: Number(v) }),
      });
    }
    setSaving(false);
    toast("Deduction rates saved");
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Teacher Revenue Deductions</h3>
        <p className="mt-1 text-sm text-muted">
          Platform share (%) of each course sale, by teacher level. Teachers rated
          &quot;Needs improvement&quot; have all courses paused automatically.
        </p>
      </div>
      {loaded && (
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Good (%)"
            type="number"
            min="0"
            max="100"
            value={good}
            onChange={(e) => setGood(e.target.value)}
          />
          <Input
            label="Excellent (%)"
            type="number"
            min="0"
            max="100"
            value={excellent}
            onChange={(e) => setExcellent(e.target.value)}
          />
          <Input
            label="Master (%)"
            type="number"
            min="0"
            max="100"
            value={master}
            onChange={(e) => setMaster(e.target.value)}
          />
        </div>
      )}
      <Button disabled={saving || !loaded} onClick={saveAll}>
        {saving ? "Saving…" : "Save Deduction Rates"}
      </Button>
    </Card>
  );
}

function IntroOutroCard() {
  const { toast } = useToast();
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [locale, setLocale] = useState("AR");
  const [type, setType] = useState("INTRO");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/intro-outro")
      .then((r) => (r.ok ? r.json() : { clips: [] }))
      .then((d) => setClips(d.clips || []));
  }, []);

  useEffect(load, [load]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);

    try {
      const presign = await fetch("/api/admin/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          category: "video",
          folder: "intro-outro",
        }),
      });
      if (!presign.ok) throw new Error((await presign.json()).error);
      const { uploadUrl, key, publicUrl } = await presign.json();

      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed");

      const saved = await fetch("/api/admin/intro-outro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, type, fileKey: key, fileUrl: publicUrl }),
      });
      if (!saved.ok) throw new Error("Save failed");

      toast(`${type === "INTRO" ? "Intro" : "Outro"} clip saved`);
      setFile(null);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/admin/intro-outro/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Clip removed");
      load();
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Intro & Outro Videos</h3>
        <p className="mt-1 text-sm text-muted">
          Per-language clips played before and after every lesson video.
        </p>
      </div>

      <form onSubmit={upload} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Select label="Language" value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="AR">العربية</option>
            <option value="KU">کوردی</option>
            <option value="TR">Türkçe</option>
            <option value="EN">English</option>
          </Select>
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="INTRO">Intro</option>
            <option value="OUTRO">Outro</option>
          </Select>
        </div>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="input file:me-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-accent"
        />
        <Button type="submit" disabled={!file || uploading} className="w-full">
          {uploading ? "Uploading…" : "Upload Clip"}
        </Button>
      </form>

      {clips !== null && clips.length > 0 && (
        <ul className="space-y-2 text-sm">
          {clips.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg border border-card-border px-3 py-2">
              <span>
                {c.type} · {c.locale}
                {c.country && ` · ${c.country.code}`}
              </span>
              <button className="text-danger hover:underline" onClick={() => remove(c.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
