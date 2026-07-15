"use client";

import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { useEffect, useState } from "react";

export type PendingCountKey =
  | "users"
  | "teacherRequests"
  | "courseReview"
  | "shortVideos"
  | "stageRequests"
  | "subscriptions"
  | "products"
  | "complaints"
  | "contentReports";

export type AdminNavItem = NavItem & { countKey?: PendingCountKey };

type Counts = Partial<Record<PendingCountKey, number>>;

export function AdminDashboardShell({
  locale,
  title,
  nav,
  children,
}: {
  locale: string;
  title: string;
  nav: AdminNavItem[];
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState<Counts>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/admin/pending-counts");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { counts?: Counts };
        if (!cancelled && data.counts) setCounts(data.counts);
      } catch {
        /* ignore — badges are optional */
      }
    }

    load();
    const timer = setInterval(load, 90_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const navWithBadges: NavItem[] = nav.map((item) => ({
    ...item,
    badge: item.countKey ? counts[item.countKey] : undefined,
  }));

  return (
    <DashboardShell locale={locale} title={title} nav={navWithBadges}>
      {children}
    </DashboardShell>
  );
}
