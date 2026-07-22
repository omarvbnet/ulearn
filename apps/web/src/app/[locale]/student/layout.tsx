import { DashboardShell } from "@/components/dashboard-shell";
import { getDictionary } from "@/i18n/config";
import type { ReactNode } from "react";

export default async function StudentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const base = `/${locale}/student`;

  return (
    <DashboardShell
      locale={locale}
      title="Student"
      nav={[
        { href: base, label: t.nav.home },
        { href: `${base}/ai`, label: t.nav.aiAssistant },
        { href: `${base}/courses`, label: t.nav.courses },
        { href: `${base}/store`, label: t.nav.store },
        { href: `${base}/subscriptions`, label: t.nav.subscriptions },
        { href: `${base}/rankings`, label: t.nav.rankings },
        { href: `${base}/certificates`, label: t.nav.certificates },
        { href: `${base}/notifications`, label: t.nav.notifications },
        { href: `${base}/devices`, label: t.nav.devices },
        { href: `${base}/support`, label: t.nav.support },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
