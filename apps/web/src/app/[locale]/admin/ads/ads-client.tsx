"use client";

import { Badge, Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

const LOCALES = [
  { id: "AR", label: "Arabic" },
  { id: "EN", label: "English" },
  { id: "KU", label: "Kurdish" },
  { id: "TR", label: "Turkish" },
] as const;

const AUDIENCES = [
  { id: "ALL", label: "All roles" },
  { id: "STUDENT", label: "Students (school)" },
  { id: "CERTIFICATE_USER", label: "Certificate users" },
  { id: "TEACHER", label: "Teachers" },
] as const;

type Stage = {
  id: string;
  nameEn: string;
  nameAr: string;
  isCertificateTrack: boolean;
};

type Ad = {
  id: string;
  locale: string;
  audience: string;
  stageId: string | null;
  stage: Stage | null;
  title: string | null;
  titleEn: string | null;
  titleAr: string | null;
  titleKu: string | null;
  titleTr: string | null;
  imageUrl: string;
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  _count: { likes: number };
};

function displayTitle(ad: Ad) {
  if (ad.title?.trim()) return ad.title;
  const byLocale =
    ad.locale === "AR"
      ? ad.titleAr
      : ad.locale === "KU"
        ? ad.titleKu
        : ad.locale === "TR"
          ? ad.titleTr
          : ad.titleEn;
  return byLocale || ad.titleEn || ad.titleAr || "Untitled";
}

function audienceLabel(id: string) {
  return AUDIENCES.find((a) => a.id === id)?.label || id;
}

export function AdsClient() {
  const { toast } = useToast();
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filterLocale, setFilterLocale] = useState<string>("ALL");
  const [filterAudience, setFilterAudience] = useState<string>("ALL");

  const [locale, setLocale] = useState<string>("AR");
  const [audience, setAudience] = useState<string>("ALL");
  const [stageId, setStageId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(() => {
    setAds(null);
    fetch("/api/admin/ads")
      .then((r) => (r.ok ? r.json() : { ads: [], stages: [] }))
      .then((d) => {
        setAds(d.ads || []);
        setStages(d.stages || []);
      });
  }, []);

  useEffect(load, [load]);

  const visible =
    ads?.filter(
      (a) =>
        (filterLocale === "ALL" || a.locale === filterLocale) &&
        (filterAudience === "ALL" || a.audience === filterAudience)
    ) ?? null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast("Please choose a banner image", "error");
      return;
    }
    if (!title.trim()) {
      toast("Title is required for the selected language", "error");
      return;
    }
    setBusy(true);
    try {
      const presign = await fetch("/api/admin/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          category: "image",
          folder: "ads",
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

      const imageUrl =
        (typeof publicUrl === "string" && publicUrl.trim().startsWith("http")
          ? publicUrl.trim()
          : null) ||
        (typeof publicUrl === "string" && publicUrl.trim().startsWith("/api/media/")
          ? publicUrl.trim()
          : null) ||
        `/api/media/${String(key)
          .split("/")
          .map((p: string) => encodeURIComponent(p))
          .join("/")}`;

      const titlePayload: Record<string, string> = { title: title.trim() };
      if (locale === "EN") titlePayload.titleEn = title.trim();
      if (locale === "AR") titlePayload.titleAr = title.trim();
      if (locale === "KU") titlePayload.titleKu = title.trim();
      if (locale === "TR") titlePayload.titleTr = title.trim();

      const res = await fetch("/api/admin/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          audience,
          stageId: stageId || null,
          ...titlePayload,
          linkUrl: linkUrl || undefined,
          sortOrder: Number(sortOrder) || 0,
          imageKey: key,
          imageUrl,
        }),
      });
      if (!res.ok) throw new Error("Save failed");

      toast(`Advertisement created for ${locale} · ${audienceLabel(audience)}`);
      setCreating(false);
      setTitle("");
      setLinkUrl("");
      setSortOrder("0");
      setAudience("ALL");
      setStageId("");
      setFile(null);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create ad", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(ad: Ad) {
    const res = await fetch(`/api/admin/ads/${ad.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !ad.isActive }),
    });
    if (res.ok) {
      toast(ad.isActive ? "Ad hidden" : "Ad is now live");
      load();
    } else {
      toast("Failed", "error");
    }
  }

  async function remove(ad: Ad) {
    if (!confirm("Delete this advertisement?")) return;
    const res = await fetch(`/api/admin/ads/${ad.id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Advertisement deleted");
      load();
    } else {
      toast("Failed", "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Advertisements"
        description="Home banners by language, role (student / certificate / teacher), and optional educational stage"
        actions={<Button onClick={() => setCreating(true)}>New Ad</Button>}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilterLocale("ALL")}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            filterLocale === "ALL"
              ? "bg-accent/20 font-semibold text-accent"
              : "bg-surface-2 text-muted"
          }`}
        >
          All languages
        </button>
        {LOCALES.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setFilterLocale(l.id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              filterLocale === l.id
                ? "bg-accent/20 font-semibold text-accent"
                : "bg-surface-2 text-muted"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {[{ id: "ALL", label: "All roles" }, ...AUDIENCES.filter((a) => a.id !== "ALL")].map(
          (a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setFilterAudience(a.id)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                filterAudience === a.id
                  ? "bg-accent/20 font-semibold text-accent"
                  : "bg-surface-2 text-muted"
              }`}
            >
              {a.label}
            </button>
          )
        )}
      </div>

      <div className="mt-6">
        {visible === null ? (
          <SkeletonRows rows={3} />
        ) : visible.length === 0 ? (
          <EmptyState title="No advertisements for this filter" />
        ) : (
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((ad) => (
              <Card key={ad.id} className="overflow-hidden p-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ad.imageUrl}
                  alt={displayTitle(ad)}
                  className="h-36 w-full object-cover"
                />
                <div className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{displayTitle(ad)}</p>
                    <Badge status={ad.isActive ? "APPROVED" : "SUSPENDED"}>
                      {ad.isActive ? "Live" : "Hidden"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {LOCALES.find((l) => l.id === ad.locale)?.label || ad.locale}
                    {" · "}
                    {audienceLabel(ad.audience)}
                    {ad.stage
                      ? ` · ${ad.stage.nameEn || ad.stage.nameAr}`
                      : " · All stages"}
                    {" · "}
                    {ad._count.likes} likes · order {ad.sortOrder}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => toggle(ad)}>
                      {ad.isActive ? "Hide" : "Publish"}
                    </Button>
                    <Button variant="danger" onClick={() => remove(ad)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="New Advertisement">
          <form onSubmit={create} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-muted">Target language</label>
              <select
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                required
              >
                {LOCALES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label} ({l.id})
                  </option>
                ))}
              </select>
            </div>
            <Select
              label="Audience (role)"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            >
              {AUDIENCES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
            <Select
              label="Educational stage (optional)"
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
            >
              <option value="">All stages</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameEn || s.nameAr}
                  {s.isCertificateTrack ? " (certificate)" : ""}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted">
              Example: audience = Students + stage = 3rd Intermediate shows only on that
              stage&apos;s home. Certificate users who filter to that stage also see it.
            </p>
            <div>
              <label className="mb-1 block text-sm text-muted">Banner image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
            </div>
            <Input
              label={`Title (${LOCALES.find((l) => l.id === locale)?.label})`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <Input
              label="Link URL (optional)"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
            <Input
              label="Sort order"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Uploading…" : "Create Ad"}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
