import { getDictionary, isValidLocale, localeDirection, type Locale } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { HtmlAttrs } from "@/components/html-attrs";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();

  const dir = localeDirection[locale as Locale];
  const dict = getDictionary(locale);

  return (
    <div lang={locale} dir={dir} className="min-h-screen bg-grid">
      <HtmlAttrs locale={locale} dir={dir} />
      <I18nProvider dict={dict}>{children}</I18nProvider>
    </div>
  );
}
