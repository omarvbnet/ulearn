"use client";

import { Button, Input } from "@/components/ui";
import { EmptyState, SkeletonRows } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Log = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  actor?: { fullLegalName: string; role: string } | null;
};

export function LogsClient() {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<Log[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (actionFilter) params.set("action", actionFilter);
    const res = await fetch(`/api/admin/logs?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setPages(data.pages);
      setTotal(data.total);
    }
    setLoading(false);
  }, [page, actionFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Input
            label="Filter by action"
            placeholder="e.g. CREATE_LESSON"
            value={actionFilter}
            onChange={(e) => {
              setPage(1);
              setActionFilter(e.target.value.toUpperCase());
            }}
          />
        </div>
        <p className="pb-2.5 text-sm text-muted">{total} entries</p>
        <a href="/api/admin/logs/export" className="ms-auto pb-1">
          <Button variant="outline">Export Excel</Button>
        </a>
      </div>

      {loading ? (
        <SkeletonRows rows={8} />
      ) : logs.length === 0 ? (
        <EmptyState title="No audit entries" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-start text-xs uppercase tracking-wide text-muted">
                <th className="p-3 text-start">Time</th>
                <th className="p-3 text-start">Actor</th>
                <th className="p-3 text-start">Action</th>
                <th className="p-3 text-start">Entity</th>
                <th className="p-3 text-start">IP</th>
              </tr>
            </thead>
            <tbody className="stagger">
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-card-border/40 transition hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap p-3 text-muted">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3">
                    {log.actor ? (
                      <>
                        {log.actor.fullLegalName}{" "}
                        <span className="text-xs text-muted">({log.actor.role})</span>
                      </>
                    ) : (
                      <span className="text-muted">System</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="badge badge-free">{log.action}</span>
                  </td>
                  <td className="p-3 text-muted">
                    {log.entityType}
                    {log.entityId ? ` · ${log.entityId.slice(0, 8)}…` : ""}
                  </td>
                  <td className="p-3 text-muted" dir="ltr">{log.ipAddress ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted">
            Page {page} of {pages}
          </span>
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
