import Link from "next/link";
import { getDictionary } from "@/i18n/config";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui";
import { ULearnLogo } from "@/components/ulearn-logo";

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <ULearnLogo size={48} />
          <span className="text-xl font-bold glow-text">{t.brand}</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher locale={locale} />
          <Link href={`/${locale}/login`}>
            <Button>{t.nav.login}</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col items-center px-6 pb-24 pt-12 text-center">
        <div className="relative mb-8">
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-3xl" />
          <ULearnLogo
            size={200}
            animated
            className="relative drop-shadow-[0_0_40px_rgba(160,32,240,0.45)]"
          />
        </div>

        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          <span className="glow-text">{t.brand}</span>
        </h1>
        <p className="mt-4 text-xl text-muted sm:text-2xl">{t.tagline}</p>
        <p className="mt-6 max-w-2xl text-muted">
          Enterprise-grade learning for school & university students and professionals seeking
          experience certificates — pre-recorded courses, quizzes, rankings, and verified
          certificates.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href={`/${locale}/login`}>
            <Button className="px-8 py-3 text-lg">{t.nav.login}</Button>
          </Link>
          <Link href={`/${locale}/admin`}>
            <Button variant="outline">{t.nav.dashboard}</Button>
          </Link>
        </div>

        <div className="mt-20 grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "WhatsApp OTP", desc: "Secure phone-based authentication" },
            { title: "Multi-Country", desc: "Country-specific curriculum & packages" },
            { title: "4 Languages", desc: "Arabic, Kurdish, Turkish, English" },
            { title: "Certificates", desc: "Verified digital experience certificates" },
          ].map((f) => (
            <div key={f.title} className="card p-5 text-start">
              <h3 className="font-semibold text-accent">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-6 px-6 pb-12 text-sm text-muted">
        <Link className="hover:text-accent" href={`/${locale}/support`}>
          Support
        </Link>
        <Link className="hover:text-accent" href={`/${locale}/privacy`}>
          Privacy Policy
        </Link>
        <Link className="hover:text-accent" href={`/${locale}/terms`}>
          Terms of Use
        </Link>
        <a className="hover:text-accent" href="mailto:support@ulearn.usmart-iot.com">
          support@ulearn.usmart-iot.com
        </a>
      </footer>
    </div>
  );
}
