import { AdminDashboardShell } from "@/components/admin-dashboard-shell";
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
    <AdminDashboardShell
      locale={locale}
      title="Admin"
      nav={[
        { href: base, label: t.nav.dashboard },
        { href: `${base}/users`, label: t.nav.users, countKey: "users" },
        { href: `${base}/teachers`, label: t.nav.teachers },
        { href: `${base}/teacher-requests`, label: t.nav.teacherRequests, countKey: "teacherRequests" },
        { href: `${base}/courses`, label: t.nav.courses },
        { href: `${base}/geography`, label: "Countries & Provinces" },
        { href: `${base}/course-review`, label: t.nav.courseReview, countKey: "courseReview" },
        { href: `${base}/course-groups`, label: t.nav.courseGroups },
        { href: `${base}/short-videos`, label: t.nav.shortVideos, countKey: "shortVideos" },
        { href: `${base}/stage-requests`, label: t.nav.stageRequests, countKey: "stageRequests" },
        { href: `${base}/ads`, label: t.nav.ads },
        { href: `${base}/products`, label: t.nav.products, countKey: "products" },
        { href: `${base}/subscriptions`, label: t.nav.subscriptions, countKey: "subscriptions" },
        { href: `${base}/notifications`, label: t.nav.notifications },
        { href: `${base}/complaints`, label: t.nav.complaints, countKey: "complaints" },
        { href: `${base}/content-reports`, label: t.nav.contentReports, countKey: "contentReports" },
        { href: `${base}/analytics`, label: t.nav.analytics },
        { href: `${base}/ai-providers`, label: t.nav.aiProviders },
        { href: `${base}/ai-knowledge`, label: t.nav.aiKnowledge },
        { href: `${base}/ai-usage`, label: t.nav.aiUsage },
        { href: `${base}/ai-subscribers`, label: "AI Subscribers" },
        { href: `${base}/logs`, label: t.nav.logs },
        { href: `${base}/settings`, label: t.nav.settings },
      ]}
    >
      {children}
    </AdminDashboardShell>
  );
}
