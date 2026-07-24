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
  const L = t.landing;

  const features = [
    { title: L.features.otpTitle, desc: L.features.otpDesc },
    { title: L.features.countryTitle, desc: L.features.countryDesc },
    { title: L.features.langTitle, desc: L.features.langDesc },
    { title: L.features.certTitle, desc: L.features.certDesc },
  ];

  const ubrdPoints = [
    { title: L.ubrdPoints.vectorTitle, desc: L.ubrdPoints.vectorDesc },
    { title: L.ubrdPoints.syncTitle, desc: L.ubrdPoints.syncDesc },
    { title: L.ubrdPoints.pdfTitle, desc: L.ubrdPoints.pdfDesc },
    { title: L.ubrdPoints.playTitle, desc: L.ubrdPoints.playDesc },
  ];

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
        <p className="mt-6 max-w-2xl text-muted">{L.subtitle}</p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href={`/${locale}/login`}>
            <Button className="px-8 py-3 text-lg">{L.ctaLogin}</Button>
          </Link>
        </div>

        <div className="mt-20 grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="card p-5 text-start">
              <h3 className="font-semibold text-accent">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.desc}</p>
            </div>
          ))}
        </div>

        <section className="mt-24 w-full text-start">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
            {L.ubrdEyebrow}
          </p>
          <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
            {L.ubrdTitle}
          </h2>
          <p className="mt-4 max-w-3xl text-lg text-muted">{L.ubrdLead}</p>
          <p className="mt-4 max-w-3xl text-muted leading-relaxed">{L.ubrdBody}</p>

          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {ubrdPoints.map((p) => (
              <div
                key={p.title}
                className="rounded-2xl border border-card-border/80 bg-card/40 p-5"
              >
                <h3 className="font-semibold text-accent">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-6 px-6 pb-12 text-sm text-muted">
        <Link className="hover:text-accent" href={`/${locale}/support`}>
          {L.footerSupport}
        </Link>
        <Link className="hover:text-accent" href={`/${locale}/privacy`}>
          {L.footerPrivacy}
        </Link>
        <Link className="hover:text-accent" href={`/${locale}/terms`}>
          {L.footerTerms}
        </Link>
        <a className="hover:text-accent" href="mailto:support@ulearn.usmart-iot.com">
          support@ulearn.usmart-iot.com
        </a>
      </footer>
    </div>
  );
}
