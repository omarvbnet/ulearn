"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input, PageHeader } from "@/components/ui";

type User = {
  id: string;
  fullLegalName: string | null;
  phone: string;
  role: string;
  status: string;
  gender: string | null;
  email: string | null;
  country?: { nameEn: string } | null;
  province?: { nameEn: string } | null;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const res = await fetch(`/api/admin/users?${params}`);
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
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

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Approve, suspend, and export users"
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

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px] text-start text-sm">
          <thead className="border-b border-card-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  No users found
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-b border-card-border/50">
                <td className="px-4 py-3 font-medium">{u.fullLegalName || "—"}</td>
                <td className="px-4 py-3" dir="ltr">
                  {u.phone}
                </td>
                <td className="px-4 py-3">{u.role}</td>
                <td className="px-4 py-3">
                  <Badge status={u.status}>{u.status}</Badge>
                </td>
                <td className="px-4 py-3 text-muted">
                  {[u.province?.nameEn, u.country?.nameEn].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {u.status === "PENDING" && (
                      <Button
                        variant="outline"
                        className="!px-3 !py-1 text-xs"
                        onClick={() => approve(u.id)}
                      >
                        Approve
                      </Button>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
