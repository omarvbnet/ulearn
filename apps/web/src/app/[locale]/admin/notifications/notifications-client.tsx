"use client";

import { Button, Card, Input, Select, Textarea } from "@/components/ui";
import { EmptyState, SkeletonRows, Tabs, useToast } from "@/components/overlay";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

type Sent = {
  id: string;
  titleEn: string;
  bodyEn: string;
  target: string;
  channels: string[];
  sentAt: string | null;
  country?: { nameEn: string } | null;
  _count: { deliveries: number };
};

type Country = { id: string; nameEn: string; provinces: { id: string; nameEn: string }[] };

const CHANNELS = [
  { id: "IN_APP", label: "In-App" },
  { id: "PUSH", label: "Push" },
  { id: "EMAIL", label: "Email" },
];

export function NotificationsClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState("compose");
  const [countries, setCountries] = useState<Country[]>([]);
  const [history, setHistory] = useState<Sent[] | null>(null);
  const [sending, setSending] = useState(false);

  const [form, setForm] = useState({
    titleEn: "", titleAr: "", titleKu: "", titleTr: "",
    bodyEn: "", bodyAr: "", bodyKu: "", bodyTr: "",
    target: "EVERYONE",
    countryId: "",
    provinceId: "",
    channels: ["IN_APP", "PUSH"] as string[],
    linkType: "admin",
    courseId: "",
    adId: "",
  });

  useEffect(() => {
    fetch("/api/countries").then(async (r) => {
      if (r.ok) setCountries((await r.json()).countries);
    });
  }, []);

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/admin/notifications");
    if (res.ok) setHistory((await res.json()).notifications);
  }, []);

  useEffect(() => {
    if (tab === "history" && history === null) loadHistory();
  }, [tab, history, loadHistory]);

  function toggleChannel(id: string) {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(id)
        ? f.channels.filter((c) => c !== id)
        : [...f.channels, id],
    }));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (form.channels.length === 0) {
      toast("Pick at least one channel", "error");
      return;
    }
    setSending(true);
    const res = await fetch("/api/admin/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        countryId: form.target === "COUNTRY" || form.target === "PROVINCE" ? form.countryId || undefined : undefined,
        provinceId: form.target === "PROVINCE" ? form.provinceId || undefined : undefined,
        linkType: form.linkType,
        screen:
          form.linkType === "course"
            ? "course"
            : form.linkType === "comment"
              ? "comments"
              : "ads",
        courseId: form.linkType === "course" ? form.courseId || undefined : undefined,
        adId:
          form.linkType === "admin" || form.linkType === "ads"
            ? form.adId || undefined
            : undefined,
      }),
    });
    setSending(false);
    if (res.ok) {
      const payload = await res.json().catch(() => null);
      const push = payload?.push as
        | {
            requested?: boolean;
            fcmConfigured?: boolean;
            tokenCount?: number;
            usersWithTokens?: number;
            recipients?: number;
            sent?: number;
            failed?: number;
            lastError?: string;
          }
        | undefined;
      if (push?.requested && !push.fcmConfigured) {
        toast("Saved, but push skipped — Firebase service account not configured on server", "error");
      } else if (push?.requested && (push.tokenCount ?? 0) === 0) {
        toast(
          `Saved in-app for ${push.recipients ?? 0} users, but none have an FCM token yet (open the app while logged in)`,
          "error"
        );
      } else if (push?.requested && (push.failed ?? 0) > 0) {
        const err = push.lastError ?? "unknown";
        let hint = "";
        if (err === "BadEnvironmentKeyInToken") {
          hint =
            " — iOS token is sandbox (local install) but Firebase APNs is production-only. Upload an APNs Auth Key (.p8) in Firebase → Cloud Messaging (works for both), or test via TestFlight.";
        } else if (
          err.includes("THIRD_PARTY_AUTH") ||
          err.includes("InvalidProviderToken")
        ) {
          hint =
            " — upload APNs Auth Key (.p8) in Firebase → Cloud Messaging for com.ulearn.mobile";
        }
        toast(
          `FCM failed ${push.failed}/${push.tokenCount} (${err})${hint}`,
          "error"
        );
      } else {
        toast(
          push?.requested
            ? `Push delivered to FCM: ${push.sent ?? 0}/${push.tokenCount ?? 0}`
            : "Notification sent"
        );
      }
      setForm((f) => ({ ...f, titleEn: "", titleAr: "", titleKu: "", titleTr: "", bodyEn: "", bodyAr: "", bodyKu: "", bodyTr: "" }));
      setHistory(null);
    } else {
      const err = await res.json().catch(() => null);
      toast(err?.error ?? "Failed to send", "error");
    }
  }

  const selectedCountry = countries.find((c) => c.id === form.countryId);

  return (
    <div className="space-y-5">
      <Tabs
        tabs={[
          { id: "compose", label: "Compose" },
          { id: "history", label: "History" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "compose" && (
        <form onSubmit={send} className="animate-slide-up grid gap-5 lg:grid-cols-3">
          <Card className="space-y-4 lg:col-span-2">
            <h3 className="font-semibold">Message</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Title (English)" value={form.titleEn} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} required />
              <Input label="العنوان (العربية)" dir="rtl" value={form.titleAr} onChange={(e) => setForm({ ...form, titleAr: e.target.value })} />
              <Input label="ناونیشان (کوردی)" dir="rtl" value={form.titleKu} onChange={(e) => setForm({ ...form, titleKu: e.target.value })} />
              <Input label="Başlık (Türkçe)" value={form.titleTr} onChange={(e) => setForm({ ...form, titleTr: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Textarea label="Body (English)" value={form.bodyEn} onChange={(e) => setForm({ ...form, bodyEn: e.target.value })} required />
              <Textarea label="النص (العربية)" dir="rtl" value={form.bodyAr} onChange={(e) => setForm({ ...form, bodyAr: e.target.value })} />
              <Textarea label="دەق (کوردی)" dir="rtl" value={form.bodyKu} onChange={(e) => setForm({ ...form, bodyKu: e.target.value })} />
              <Textarea label="Metin (Türkçe)" value={form.bodyTr} onChange={(e) => setForm({ ...form, bodyTr: e.target.value })} />
            </div>
            <p className="text-xs text-muted">Empty translations fall back to English.</p>
          </Card>

          <div className="space-y-5">
            <Card className="space-y-4">
              <h3 className="font-semibold">Audience</h3>
              <Select label="Target" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}>
                <option value="EVERYONE">Everyone (approved users)</option>
                <option value="COUNTRY">Specific country</option>
                <option value="PROVINCE">Specific province</option>
              </Select>
              {(form.target === "COUNTRY" || form.target === "PROVINCE") && (
                <Select label="Country" value={form.countryId} onChange={(e) => setForm({ ...form, countryId: e.target.value, provinceId: "" })} required>
                  <option value="">Select…</option>
                  {countries.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
                </Select>
              )}
              {form.target === "PROVINCE" && selectedCountry && (
                <Select label="Province" value={form.provinceId} onChange={(e) => setForm({ ...form, provinceId: e.target.value })} required>
                  <option value="">Select…</option>
                  {selectedCountry.provinces.map((p) => <option key={p.id} value={p.id}>{p.nameEn}</option>)}
                </Select>
              )}
            </Card>

            <Card className="space-y-3">
              <h3 className="font-semibold">Channels</h3>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => toggleChannel(ch.id)}
                    className={cn(
                      "rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-200",
                      form.channels.includes(ch.id)
                        ? "border-accent/60 bg-accent/15 text-accent shadow-[0_0_16px_rgba(0,229,255,0.15)]"
                        : "border-card-border text-muted hover:border-accent/30"
                    )}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="space-y-3">
              <h3 className="font-semibold">Tap opens</h3>
              <Select
                label="Deep link"
                value={form.linkType}
                onChange={(e) => setForm({ ...form, linkType: e.target.value })}
              >
                <option value="admin">Ads / offers board</option>
                <option value="ads">Highlight an ad</option>
                <option value="course">Course detail</option>
                <option value="comment">Reel comments</option>
              </Select>
              {form.linkType === "course" && (
                <Input
                  label="Course ID"
                  value={form.courseId}
                  onChange={(e) => setForm({ ...form, courseId: e.target.value })}
                  placeholder="Course UUID"
                />
              )}
              {(form.linkType === "admin" || form.linkType === "ads") && (
                <Input
                  label="Ad ID (optional)"
                  value={form.adId}
                  onChange={(e) => setForm({ ...form, adId: e.target.value })}
                  placeholder="Highlight a specific ad"
                />
              )}
              <p className="text-xs text-muted">
                Push + in-app taps open the matching screen on mobile.
              </p>
            </Card>

            <Button type="submit" disabled={sending} className="w-full">
              {sending ? "Sending…" : "Send Notification"}
            </Button>
          </div>
        </form>
      )}

      {tab === "history" && (
        history === null ? (
          <SkeletonRows rows={4} />
        ) : history.length === 0 ? (
          <EmptyState title="Nothing sent yet" />
        ) : (
          <div className="stagger space-y-3">
            {history.map((n) => (
              <Card key={n.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{n.titleEn}</p>
                  <span className="text-xs text-muted">
                    {n.sentAt ? new Date(n.sentAt).toLocaleString() : "—"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{n.bodyEn}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="badge badge-free">{n.target}{n.country ? `: ${n.country.nameEn}` : ""}</span>
                  {n.channels.map((c) => <span key={c} className="badge badge-pending">{c}</span>)}
                  <span className="text-muted">{n._count.deliveries} deliveries</span>
                </div>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
