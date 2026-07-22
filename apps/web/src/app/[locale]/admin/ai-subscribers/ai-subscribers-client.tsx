"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { SkeletonRows, useToast } from "@/components/overlay";

type Province = { id: string; nameEn: string };
type Row = {
  id: string;
  name: string | null;
  phone: string;
  province: string | null;
  plan: string;
  used: number;
  remaining: number;
  courseCount: number;
  expiresAt: string | null;
  subscriptionId: string | null;
};

export function AiSubscribersClient() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [provinceId, setProvinceId] = useState("");
  const [plan, setPlan] = useState("");
  const [q, setQ] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (provinceId) params.set("provinceId", provinceId);
    if (plan) params.set("plan", plan);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/admin/ai-subscribers?${params}`);
    setLoading(false);
    if (!res.ok) {
      toast("Failed to load AI subscribers", "error");
      return;
    }
    const data = await res.json();
    setRows(data.subscribers || []);
    setProvinces(data.provinces || []);
  }, [provinceId, plan, q, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function exportExcel() {
    const params = new URLSearchParams();
    if (provinceId) params.set("provinceId", provinceId);
    window.location.href = `/api/admin/ai-subscribers/export?${params}`;
  }

  async function cancelAi(row: Row) {
    if (!row.subscriptionId && row.plan === "FREE") {
      toast("This user has no paid AI subscription to cancel", "error");
      return;
    }
    if (
      !confirm(
        `Cancel AI subscription for ${row.name || row.phone}? They will lose paid AI access immediately.`
      )
    ) {
      return;
    }
    setCancellingId(row.id);
    const res = await fetch("/api/admin/ai-subscribers/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        row.subscriptionId
          ? { subscriptionId: row.subscriptionId }
          : { userId: row.id }
      ),
    });
    setCancellingId(null);
    if (res.ok) {
      toast("AI subscription cancelled");
      void load();
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Failed to cancel", "error");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Subscribers"
        description="Users with AI Creative activity or an AI Creative plan, by province. Cancel paid AI access anytime."
        actions={
          <Button onClick={exportExcel}>
            Export Excel
          </Button>
        }
      />

      <Card className="grid gap-3 sm:grid-cols-4">
        <Input
          label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or phone"
        />
        <Select
          label="Province"
          value={provinceId}
          onChange={(e) => setProvinceId(e.target.value)}
        >
          <option value="">All provinces</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameEn}
            </option>
          ))}
        </Select>
        <Select label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="">All plans</option>
          <option value="FREE">FREE</option>
          <option value="COURSES_UNLOCK">COURSES_UNLOCK</option>
          <option value="MONTHLY">Paid / offer</option>
        </Select>
        <div className="flex items-end">
          <Button className="w-full" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </Card>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Province</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Uses</th>
                <th className="px-4 py-3">Courses</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    No AI Creative users yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 font-medium">{r.name || "—"}</td>
                    <td className="px-4 py-3">{r.phone}</td>
                    <td className="px-4 py-3">{r.province || "—"}</td>
                    <td className="px-4 py-3">{r.plan}</td>
                    <td className="px-4 py-3">
                      {r.used} used / {r.remaining} left
                    </td>
                    <td className="px-4 py-3">{r.courseCount}</td>
                    <td className="px-4 py-3">
                      {r.expiresAt
                        ? new Date(r.expiresAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {r.subscriptionId ? (
                        <Button
                          variant="danger"
                          className="!py-1.5 text-xs"
                          disabled={cancellingId === r.id}
                          onClick={() => void cancelAi(r)}
                        >
                          {cancellingId === r.id ? "…" : "Cancel AI"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
