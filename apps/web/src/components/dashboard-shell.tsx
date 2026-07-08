"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ToastProvider } from "@/components/overlay";
import { ULearnLogo } from "@/components/ulearn-logo";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string };

export function DashboardShell({
  locale,
  title,
  nav,
  children,
}: {
  locale: string;
  title: string;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push(`/${locale}/login`);
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-card-border bg-card/80 p-4 backdrop-blur lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <ULearnLogo size={40} />
          <div>
            <p className="font-bold glow-text">U Learn</p>
            <p className="text-xs text-muted">{title}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("sidebar-link", active && "active")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="sidebar-link mt-4 text-start text-danger hover:bg-danger/10"
        >
          Logout
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-card-border px-4 py-3 lg:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <ULearnLogo size={32} />
            <span className="font-semibold">{title}</span>
          </div>
          <div className="ms-auto flex items-center gap-3">
            <LanguageSwitcher locale={locale} />
          </div>
        </header>

        <nav className="flex gap-2 overflow-x-auto border-b border-card-border px-4 py-2 lg:hidden">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-white/5"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="animate-fade-in flex-1 px-4 py-6 lg:px-8">
          <ToastProvider>{children}</ToastProvider>
        </main>
      </div>
    </div>
  );
}
