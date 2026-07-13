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

      <AiCreativeConfigCard />

      <VideoWatermarkCard />

      <IntroOutroCard />
    </div>
  );
}

function AiCreativeConfigCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [freeUses, setFreeUses] = useState("5");
  const [courseUnlockCount, setCourseUnlockCount] = useState("6");
  const [monthlyUsd, setMonthlyUsd] = useState("4.99");
  const [yearlyIqd, setYearlyIqd] = useState("60000");
  const [appleMonthly, setAppleMonthly] = useState("com.ulearn.mobile.ai.monthly");
  const [appleYearly, setAppleYearly] = useState("com.ulearn.mobile.ai.yearly");
  const [googleMonthly, setGoogleMonthly] = useState("ai_monthly");
  const [googleYearly, setGoogleYearly] = useState("ai_yearly");
  const [offersJson, setOffersJson] = useState("[]");

  useEffect(() => {
    fetch("/api/admin/settings").then(async (r) => {
      if (r.ok) {
        const { settings } = await r.json();
        const row = settings.find(
          (s: { key: string }) => s.key === "ai_creative_config"
        );
        const v = (row?.value || {}) as Record<string, unknown>;
        if (typeof v.freeUses === "number") setFreeUses(String(v.freeUses));
        if (typeof v.courseUnlockCount === "number")
          setCourseUnlockCount(String(v.courseUnlockCount));
        if (typeof v.monthlyUsd === "number") setMonthlyUsd(String(v.monthlyUsd));
        else if (typeof v.monthlyPrice === "number" && v.currency === "USD")
          setMonthlyUsd(String(v.monthlyPrice));
        if (typeof v.yearlyIqd === "number") setYearlyIqd(String(v.yearlyIqd));
        if (typeof v.appleProductIdMonthly === "string")
          setAppleMonthly(v.appleProductIdMonthly);
        if (typeof v.appleProductIdYearly === "string")
          setAppleYearly(v.appleProductIdYearly);
        if (typeof v.googleProductIdMonthly === "string")
          setGoogleMonthly(v.googleProductIdMonthly);
        if (typeof v.googleProductIdYearly === "string")
          setGoogleYearly(v.googleProductIdYearly);
        if (Array.isArray(v.offers)) setOffersJson(JSON.stringify(v.offers, null, 2));
      }
      setLoading(false);
    });
  }, []);

  async function saveConfig() {
    let offers: unknown[] = [];
    try {
      offers = JSON.parse(offersJson);
      if (!Array.isArray(offers)) throw new Error("offers must be an array");
    } catch {
      toast("Offers JSON is invalid", "error");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "ai_creative_config",
        value: {
          freeUses: Number(freeUses),
          courseUnlockCount: Number(courseUnlockCount),
          monthlyUsd: Number(monthlyUsd),
          yearlyIqd: Number(yearlyIqd),
          monthlyPrice: Number(monthlyUsd),
          currency: "USD",
          appleProductIdMonthly: appleMonthly,
          appleProductIdYearly: appleYearly,
          googleProductIdMonthly: googleMonthly,
          googleProductIdYearly: googleYearly,
          offers,
        },
      }),
    });
    setSaving(false);
    if (res.ok) toast("AI plan config saved");
    else toast("Failed to save AI plan config", "error");
  }

  if (loading) return <SkeletonRows rows={2} />;

  return (
    <Card className="space-y-4 md:col-span-2">
      <div>
        <h3 className="font-semibold">AI plans & entitlements</h3>
        <p className="mt-1 text-sm text-muted">
          Free uses and course-unlock threshold. Monthly price is USD; yearly is IQD.
          Learners without the course offer must pay via Apple / Google in-app purchase.
          Product IDs must match App Store Connect and Google Play Console.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Free uses"
          type="number"
          min="0"
          value={freeUses}
          onChange={(e) => setFreeUses(e.target.value)}
        />
        <Input
          label="Course unlock count"
          type="number"
          min="0"
          value={courseUnlockCount}
          onChange={(e) => setCourseUnlockCount(e.target.value)}
        />
        <Input
          label="Monthly price (USD)"
          type="number"
          min="0"
          step="0.01"
          value={monthlyUsd}
          onChange={(e) => setMonthlyUsd(e.target.value)}
        />
        <Input
          label="Yearly price (IQD)"
          type="number"
          min="0"
          value={yearlyIqd}
          onChange={(e) => setYearlyIqd(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Apple product ID (monthly)"
          value={appleMonthly}
          onChange={(e) => setAppleMonthly(e.target.value)}
        />
        <Input
          label="Apple product ID (yearly)"
          value={appleYearly}
          onChange={(e) => setAppleYearly(e.target.value)}
        />
        <Input
          label="Google product ID (monthly)"
          value={googleMonthly}
          onChange={(e) => setGoogleMonthly(e.target.value)}
        />
        <Input
          label="Google product ID (yearly)"
          value={googleYearly}
          onChange={(e) => setGoogleYearly(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">
          Offers JSON
        </label>
        <textarea
          className="min-h-[120px] w-full rounded-lg border border-[var(--border)] bg-transparent p-3 font-mono text-xs"
          value={offersJson}
          onChange={(e) => setOffersJson(e.target.value)}
          spellCheck={false}
          placeholder='[{"id":"offer1","label":"Launch 30 days","price":10000,"durationDays":30,"active":true}]'
        />
      </div>
      <Button disabled={saving} onClick={() => void saveConfig()}>
        {saving ? "Saving…" : "Save AI Plan Config"}
      </Button>
    </Card>
  );
}

function VideoWatermarkCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [brandText, setBrandText] = useState("U Learn");
  const [opacity, setOpacity] = useState("0.45");
  const [fontSize, setFontSize] = useState("28");
  const [position, setPosition] = useState("bottom-right");
  const [includeCourseName, setIncludeCourseName] = useState(true);
  const [includeInstructorName, setIncludeInstructorName] = useState(true);

  useEffect(() => {
    fetch("/api/admin/video-watermark")
      .then(async (r) => {
        if (!r.ok) return;
        const { config } = await r.json();
        setBrandText(config.brandText ?? "U Learn");
        setOpacity(String(config.opacity ?? 0.45));
        setFontSize(String(config.fontSize ?? 28));
        setPosition(config.position ?? "bottom-right");
        setIncludeCourseName(config.includeCourseName ?? true);
        setIncludeInstructorName(config.includeInstructorName ?? true);
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    const res = await fetch("/api/admin/video-watermark", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandText,
        opacity: Number(opacity),
        fontSize: Number(fontSize),
        position,
        includeCourseName,
        includeInstructorName,
      }),
    });
    setSaving(false);
    if (res.ok) toast("Video watermark settings saved");
    else toast("Failed to save watermark settings", "error");
  }

  if (loading) return <Card><SkeletonRows rows={2} /></Card>;

  return (
    <Card className="space-y-4 md:col-span-2">
      <div>
        <h3 className="font-semibold">Video Watermark</h3>
        <p className="mt-1 text-sm text-muted">
          Burned into every uploaded lesson on device before direct R2 upload. Not a player overlay.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Brand text" value={brandText} onChange={(e) => setBrandText(e.target.value)} />
        <Select label="Position" value={position} onChange={(e) => setPosition(e.target.value)}>
          <option value="bottom-right">Bottom right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="top-right">Top right</option>
          <option value="top-left">Top left</option>
        </Select>
        <Input
          label="Opacity (0.1 – 1)"
          type="number"
          min="0.1"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(e) => setOpacity(e.target.value)}
        />
        <Input
          label="Font size (px)"
          type="number"
          min="12"
          max="72"
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={includeCourseName}
          onChange={(e) => setIncludeCourseName(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Include course name in watermark
      </label>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={includeInstructorName}
          onChange={(e) => setIncludeInstructorName(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Include instructor name in watermark
      </label>
      <Button disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save Watermark Settings"}
      </Button>
    </Card>
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
