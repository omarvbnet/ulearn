import { DashboardShell } from "@/components/dashboard-shell";
import { getDictionary } from "@/i18n/config";
import type { ReactNode } from "react";

export default async function TeacherLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const base = `/${locale}/teacher`;

  return (
    <DashboardShell
      locale={locale}
      title="Teacher"
      nav={[
        { href: base, label: t.nav.dashboard },
        { href: `${base}/students`, label: t.nav.users },
        { href: `${base}/questions`, label: t.nav.questions },
        { href: `${base}/analytics`, label: t.nav.analytics },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
