"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input, PageHeader } from "@/components/ui";
import { useToast } from "@/components/overlay";

type User = {
  id: string;
  fullLegalName: string | null;
  phone: string;
  role: string;
  status: string;
  gender: string | null;
  email: string | null;
  deviceLimit?: number;
  activeDeviceCount?: number;
  country?: { nameEn: string } | null;
  province?: { nameEn: string } | null;
};

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draftLimits, setDraftLimits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const res = await fetch(`/api/admin/users?${params}`);
    if (res.ok) {
      const data = await res.json();
      const list = (data.users || []) as User[];
      setUsers(list);
      const drafts: Record<string, string> = {};
      for (const u of list) {
        drafts[u.id] = String(u.deviceLimit ?? 1);
      }
      setDraftLimits(drafts);
    }
    setLoading(false);
  }, [q, status]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id: string) {
    await fetch(`/api/admin/users/${id}/approve`, { method: "POST" });
    load();
  }

  async function suspend(id: string) {
    await fetch(`/api/admin/users/${id}/suspend`, { method: "POST" });
    load();
  }

  async function reject(id: string) {
    const reason = window.prompt("Rejection reason (optional):") ?? undefined;
    await fetch(`/api/admin/users/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    load();
  }

  async function saveDeviceLimit(user: User) {
    const raw = draftLimits[user.id] ?? String(user.deviceLimit ?? 1);
    const deviceLimit = Math.min(20, Math.max(1, Number(raw) || 1));
    setSavingId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/devices`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceLimit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update device limit");
      }
      toast(`Device limit set to ${deviceLimit} for ${user.fullLegalName || user.phone}`);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id
            ? {
                ...u,
                deviceLimit,
                activeDeviceCount:
                  data.activeDeviceCount ?? u.activeDeviceCount,
              }
            : u
        )
      );
      setDraftLimits((d) => ({ ...d, [user.id]: String(deviceLimit) }));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to update", "error");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Approve, suspend, set device limits, and export users"
        actions={
          <a href="/api/admin/users/export">
            <Button variant="outline">Export Excel</Button>
          </a>
        }
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <Input
          placeholder="Search name, phone, email..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <select
          className="input !w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="INACTIVE">Inactive</option>
        </select>
        <Button variant="outline" onClick={load}>
          Refresh
        </Button>
      </div>

      <p className="mb-4 text-xs text-muted">
        Device limit controls how many phones/tablets can stay logged in at once.
        The demo / App Review phone is limited like any other user — raise its
        limit here if reviewers need more than one device (default is 1).
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[960px] text-start text-sm">
          <thead className="border-b border-card-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Devices</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No users found
                </td>
              </tr>
            )}
            {users.map((u) => {
              const active = u.activeDeviceCount ?? 0;
              const limit = u.deviceLimit ?? 1;
              const dirty = (draftLimits[u.id] ?? String(limit)) !== String(limit);
              return (
                <tr key={u.id} className="border-b border-card-border/50">
                  <td className="px-4 py-3 font-medium">{u.fullLegalName || "—"}</td>
                  <td className="px-4 py-3" dir="ltr">
                    {u.phone}
                  </td>
                  <td className="px-4 py-3">{u.role}</td>
                  <td className="px-4 py-3">
                    <Badge status={u.status}>{u.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted whitespace-nowrap">
                        {active}/{limit} active
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        className="input !w-16 !px-2 !py-1 text-xs"
                        value={draftLimits[u.id] ?? String(limit)}
                        onChange={(e) =>
                          setDraftLimits((d) => ({
                            ...d,
                            [u.id]: e.target.value,
                          }))
                        }
                        title="Max devices (1–20)"
                      />
                      <Button
                        variant="outline"
                        className="!px-2 !py-1 text-xs"
                        disabled={savingId === u.id || !dirty}
                        onClick={() => saveDeviceLimit(u)}
                      >
                        {savingId === u.id ? "…" : "Save"}
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {[u.province?.nameEn, u.country?.nameEn].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {u.status === "PENDING" && (
                        <>
                          <Button
                            variant="outline"
                            className="!px-3 !py-1 text-xs"
                            onClick={() => approve(u.id)}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            className="!px-3 !py-1 text-xs"
                            onClick={() => reject(u.id)}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {u.status === "APPROVED" && (
                        <Button
                          variant="danger"
                          className="!px-3 !py-1 text-xs"
                          onClick={() => suspend(u.id)}
                        >
                          Suspend
                        </Button>
                      )}
                      {u.status === "SUSPENDED" && (
                        <Button
                          variant="outline"
                          className="!px-3 !py-1 text-xs"
                          onClick={() => approve(u.id)}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
