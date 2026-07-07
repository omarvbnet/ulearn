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

type Stats = {
  totalUsers: number;
  totalStudents: number;
  certificateUsers: number;
  maleCount: number;
  femaleCount: number;
  activeUsers: number;
  inactiveUsers: number;
  pendingUsers: number;
  activeSubscriptions: number;
  pendingRequests: number;
  registrationTrends: { date: string; count: number }[];
  revenue: { totalRevenue: number; subscriptionCount: number };
  completion: { completionRate: number };
  provinceStats: { name: string; count: number }[];
};

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/analytics")
      .then(async (r) => {
        if (!r.ok) throw new Error("Unauthorized or unavailable");
        return r.json();
      })
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="card p-8 text-center">
        <p className="text-muted">{error}</p>
        <p className="mt-2 text-sm text-muted">
          Sign in as Super Admin or Country Admin to view analytics.
        </p>
      </div>
    );
  }

  if (!stats) {
    return <p className="text-muted">Loading analytics...</p>;
  }

  return (
    <div>
      <PageHeader
        title="Admin Dashboard"
        description="Platform overview and key metrics"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Users" value={stats.totalUsers} />
        <StatCard label="Students" value={stats.totalStudents} />
        <StatCard label="Certificate Users" value={stats.certificateUsers} />
        <StatCard label="Pending Approvals" value={stats.pendingUsers} />
        <StatCard label="Active Subscriptions" value={stats.activeSubscriptions} />
        <StatCard label="Activation Requests" value={stats.pendingRequests} />
        <StatCard
          label="Revenue"
          value={stats.revenue.totalRevenue.toLocaleString()}
        />
        <StatCard
          label="Completion Rate"
          value={`${stats.completion.completionRate.toFixed(1)}%`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Registration Trends (30 days)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.registrationTrends}>
                <defs>
                  <linearGradient id="reg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a020f0" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#a020f0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a1a35" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: "#8b9bb4", fontSize: 11 }} />
                <YAxis tick={{ fill: "#8b9bb4", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "#0c0c1a",
                    border: "1px solid #1a1a35",
                    borderRadius: 8,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#00e5ff"
                  fill="url(#reg)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="mb-4 font-semibold">Demographics</h2>
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Male</span>
              <span className="font-semibold">{stats.maleCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Female</span>
              <span className="font-semibold">{stats.femaleCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Active</span>
              <span className="font-semibold text-success">{stats.activeUsers}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Inactive</span>
              <span className="font-semibold text-warning">{stats.inactiveUsers}</span>
            </div>
          </div>

          <h3 className="mb-3 mt-8 font-semibold">By Province</h3>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {stats.provinceStats.map((p) => (
              <div key={p.name} className="flex justify-between text-sm">
                <span className="text-muted">{p.name}</span>
                <span>{p.count}</span>
              </div>
            ))}
            {stats.provinceStats.length === 0 && (
              <p className="text-sm text-muted">No data yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
