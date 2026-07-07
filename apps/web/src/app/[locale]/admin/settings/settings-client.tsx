"use client";

import { Button, Card, Input } from "@/components/ui";
import { SkeletonRows, useToast } from "@/components/overlay";
import { useEffect, useState } from "react";

type SettingsMap = Record<string, unknown>;

export function SettingsClient() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expiryDate, setExpiryDate] = useState("07-15");
  const [excludeCertUsers, setExcludeCertUsers] = useState(true);
  const [inactivityDays, setInactivityDays] = useState("90");
  const [otpExpiryMin, setOtpExpiryMin] = useState("5");

  useEffect(() => {
    fetch("/api/admin/settings").then(async (r) => {
      if (r.ok) {
        const { settings } = await r.json();
        const map: SettingsMap = {};
        for (const s of settings) map[s.key] = s.value;
        if (map.subscription_expiry_date) setExpiryDate(String(map.subscription_expiry_date));
        if (map.expiry_excludes_certificate_users !== undefined)
          setExcludeCertUsers(Boolean(map.expiry_excludes_certificate_users));
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
            await save("subscription_expiry_date", expiryDate, "Expiry date");
            await save("expiry_excludes_certificate_users", excludeCertUsers, "Certificate exclusion");
          }}
        >
          Save Expiry Settings
        </Button>
      </Card>

      <Card className="space-y-4">
        <div>
          <h3 className="font-semibold">Inactive Users</h3>
          <p className="mt-1 text-sm text-muted">
            Users with no activity for this many days are marked INACTIVE by the daily cron job.
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

      <Card className="space-y-2">
        <h3 className="font-semibold">Intro & Outro Videos</h3>
        <p className="text-sm text-muted">
          Upload per-language intro/outro clips in Courses → lesson media, using the type
          selector. They are automatically stitched into every lesson playback.
        </p>
      </Card>
    </div>
  );
}
