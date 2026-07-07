import { DashboardShell } from "@/components/dashboard-shell";
import { getDictionary } from "@/i18n/config";
import type { ReactNode } from "react";

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const base = `/${locale}/admin`;

  return (
    <DashboardShell
      locale={locale}
      title="Admin"
      nav={[
        { href: base, label: t.nav.dashboard },
        { href: `${base}/users`, label: t.nav.users },
        { href: `${base}/teachers`, label: t.nav.teachers },
        { href: `${base}/courses`, label: t.nav.courses },
        { href: `${base}/course-review`, label: t.nav.courseReview },
        { href: `${base}/subscriptions`, label: t.nav.subscriptions },
        { href: `${base}/notifications`, label: t.nav.notifications },
        { href: `${base}/complaints`, label: t.nav.complaints },
        { href: `${base}/analytics`, label: t.nav.analytics },
        { href: `${base}/logs`, label: t.nav.logs },
        { href: `${base}/settings`, label: t.nav.settings },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
