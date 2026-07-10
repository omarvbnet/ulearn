"use client";

import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Ad = {
  id: string;
  titleEn: string | null;
  titleAr: string | null;
  imageUrl: string;
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  _count: { likes: number };
};

export function AdsClient() {
  const { toast } = useToast();
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [titleEn, setTitleEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(() => {
    setAds(null);
    fetch("/api/admin/ads")
      .then((r) => (r.ok ? r.json() : { ads: [] }))
      .then((d) => setAds(d.ads || []));
  }, []);

  useEffect(load, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast("Please choose a banner image", "error");
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

      // Prefer CDN public URL; otherwise same-origin media gateway for R2 keys.
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

      const res = await fetch("/api/admin/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleEn: titleEn || undefined,
          titleAr: titleAr || undefined,
          linkUrl: linkUrl || undefined,
          sortOrder: Number(sortOrder) || 0,
          imageKey: key,
          imageUrl,
        }),
      });
      if (!res.ok) throw new Error("Save failed");

      toast("Advertisement created");
      setCreating(false);
      setTitleEn("");
      setTitleAr("");
      setLinkUrl("");
      setSortOrder("0");
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
        description="Promotional banners shown on the mobile app home screen"
        actions={<Button onClick={() => setCreating(true)}>New Ad</Button>}
      />

      <div className="mt-6">
        {ads === null ? (
          <SkeletonRows rows={3} />
        ) : ads.length === 0 ? (
          <EmptyState title="No advertisements yet" />
        ) : (
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ads.map((ad) => (
              <Card key={ad.id} className="overflow-hidden p-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ad.imageUrl}
                  alt={ad.titleEn ?? "Advertisement"}
                  className="h-36 w-full object-cover"
                />
                <div className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{ad.titleEn || ad.titleAr || "Untitled"}</p>
                    <Badge status={ad.isActive ? "APPROVED" : "SUSPENDED"}>
                      {ad.isActive ? "Live" : "Hidden"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">
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
              <label className="mb-1 block text-sm text-muted">Banner image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
            </div>
            <Input
              label="Title (English)"
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
            />
            <Input
              label="Title (Arabic)"
              value={titleAr}
              onChange={(e) => setTitleAr(e.target.value)}
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
