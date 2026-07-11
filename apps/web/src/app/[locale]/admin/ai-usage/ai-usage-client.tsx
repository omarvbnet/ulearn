"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader, StatCard } from "@/components/ui";

type Summary = {
  totals: {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    errors: number;
    successRate: number;
  };
  byDay: { date: string; requests: number; tokens: number; cost: number; errors: number }[];
  byProvider: {
    providerId: string;
    name: string;
    type: string;
    requests: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    errors: number;
    avgLatencyMs: number;
  }[];
};

export function AiUsageClient() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/ai/usage?days=30")
      .then(async (r) => {
        if (!r.ok) throw new Error("SUPER_ADMIN required");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="card p-8 text-center">
        <p className="text-muted">{error}</p>
      </div>
    );
  }

  if (!data) return <p className="text-muted">Loading AI usage…</p>;

  return (
    <div>
      <PageHeader title="AI Usage" description="Tokens, cost estimates, and latency (last 30 days)" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Requests" value={data.totals.requests} />
        <StatCard label="Tokens in" value={data.totals.tokensIn} />
        <StatCard label="Tokens out" value={data.totals.tokensOut} />
        <StatCard label="Est. cost (USD)" value={data.totals.cost.toFixed(4)} />
        <StatCard label="Errors" value={data.totals.errors} />
        <StatCard label="Success %" value={data.totals.successRate} />
      </div>

      <div className="card mb-6 h-72 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.byDay}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey="requests" stroke="#0f766e" fill="#99f6e4" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-3">
        {data.byProvider.map((p) => (
          <div key={p.providerId} className="card p-4">
            <div className="font-semibold">
              {p.name} <span className="text-sm text-muted">({p.type})</span>
            </div>
            <div className="mt-1 text-sm text-muted">
              {p.requests} req · {p.tokensIn + p.tokensOut} tokens · ${p.cost.toFixed(4)} · avg{" "}
              {p.avgLatencyMs}ms · {p.errors} errors
            </div>
          </div>
        ))}
        {!data.byProvider.length ? <p className="text-muted">No usage yet.</p> : null}
      </div>
    </div>
  );
}
