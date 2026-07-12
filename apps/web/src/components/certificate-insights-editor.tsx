"use client";

import { Button, Card } from "@/components/ui";
import { useToast } from "@/components/overlay";
import { useT } from "@/i18n/client";
import { getLocalizedField } from "@/lib/utils";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type InterestOption = {
  id: string;
  nameEn: string;
  nameAr?: string | null;
  nameKu?: string | null;
  nameTr?: string | null;
};

const MAX = 5;

/** Multi-select insights editor for CERTIFICATE_USER — drives courses + AI. */
export function CertificateInsightsEditor() {
  const t = useT();
  const { toast } = useToast();
  const { locale } = useParams<{ locale: string }>();
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<InterestOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const meRes = await fetch("/api/auth/me");
      const me = await meRes.json();
      if (me?.user?.role !== "CERTIFICATE_USER") {
        setVisible(false);
        return;
      }
      setVisible(true);
      const current =
        (me.user.certificateProfile?.interests as { subject?: InterestOption }[] | undefined)?.map(
          (i) => i.subject?.id
        ).filter(Boolean) as string[] || [];
      setSelected(current);

      const catalogRes = await fetch("/api/certificate-interests");
      const catalog = await catalogRes.json();
      setOptions((catalog.interests as InterestOption[]) || []);
    } catch {
      setVisible(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX) {
        toast(t.student.insightsMax, "error");
        return prev;
      }
      return [...prev, id];
    });
  }

  async function save() {
    if (!selected.length) {
      toast(t.student.insightsMin, "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/profile/certificate-interests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interestSubjectIds: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed");
      toast(t.student.insightsSaved);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : t.student.insightsSaveFailed, "error");
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return (
    <Card className="mb-6 border-accent/20">
      <h3 className="text-lg font-semibold">{t.student.insightsTitle}</h3>
      <p className="mt-1 text-sm text-muted">{t.student.insightsHint}</p>
      {loading ? (
        <p className="mt-4 text-sm text-muted">{t.common.loading}</p>
      ) : (
        <>
          <p className="mt-3 text-xs font-semibold text-accent">
            {t.student.insightsCount
              .replace("{count}", String(selected.length))
              .replace("{max}", String(MAX))}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {options.map((opt) => {
              const on = selected.includes(opt.id);
              const label =
                getLocalizedField(opt as unknown as Record<string, unknown>, "name", locale) ||
                opt.nameEn;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggle(opt.id)}
                  className={
                    on
                      ? "rounded-full border border-accent bg-accent/15 px-3 py-1.5 text-sm font-medium text-accent"
                      : "rounded-full border border-border px-3 py-1.5 text-sm text-muted hover:border-accent/40"
                  }
                >
                  {label}
                </button>
              );
            })}
            {!options.length && (
              <p className="text-sm text-muted">{t.student.insightsEmptyCatalog}</p>
            )}
          </div>
          <div className="mt-4">
            <Button onClick={save} disabled={saving}>
              {saving ? t.common.loading : t.student.insightsSave}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
