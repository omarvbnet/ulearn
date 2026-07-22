import Link from "next/link";
import { getDictionary } from "@/i18n/config";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ULearnLogo } from "@/components/ulearn-logo";

export default async function PublicTermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href={`/${locale}`} className="flex items-center gap-3">
          <ULearnLogo size={40} />
          <span className="text-lg font-bold">{t.brand}</span>
        </Link>
        <LanguageSwitcher locale={locale} />
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 pb-24 text-start">
        <h1 className="text-3xl font-bold tracking-tight">Terms of Use (EULA)</h1>
        <p className="text-sm text-muted">Last updated: July 2026</p>

        <p className="text-muted">
          These Terms of Use (“Terms”) govern your use of the U Learn mobile application and related
          services operated by U Learn (“we”, “us”). By downloading, accessing, or using U Learn,
          you agree to these Terms. If you do not agree, do not use the app.
        </p>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">1. The service</h2>
          <p className="text-muted">
            U Learn provides educational content including courses, lessons, quizzes, short videos,
            and AI learning tools for students, certificate learners, and teachers. Features may
            vary by country, role, and subscription or purchase status.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">2. Accounts</h2>
          <p className="text-muted">
            You must provide accurate registration information and keep your account secure. You are
            responsible for activity under your account. We may suspend or terminate accounts that
            violate these Terms or applicable law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">3. Purchases and auto-renewable subscriptions</h2>
          <p className="text-muted">
            U Learn may offer one-time course unlocks and auto-renewable subscriptions (for example,
            AI Assistant Monthly and AI Assistant Yearly) through the Apple App Store or Google Play.
          </p>
          <ul className="list-disc space-y-2 ps-5 text-muted">
            <li>
              Payment is charged to your Apple ID or Google account at confirmation of purchase.
            </li>
            <li>
              Subscriptions renew automatically unless cancelled at least 24 hours before the end of
              the current period.
            </li>
            <li>
              Your account will be charged for renewal within 24 hours prior to the end of the
              current period at the then-applicable rate.
            </li>
            <li>
              You can manage or cancel subscriptions in your device account settings (for Apple:
              Settings → Apple ID → Subscriptions).
            </li>
            <li>
              Any unused portion of a free trial period, if offered, is forfeited when you purchase
              a subscription.
            </li>
          </ul>
          <p className="text-muted">
            Course unlocks purchased as non-consumable (or equivalent) in-app purchases grant access
            for the period described in the product and in the app at the time of purchase.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">4. Content and acceptable use</h2>
          <p className="text-muted">
            Course videos, documents, quizzes, and other materials are licensed for personal
            educational use only. You may not copy, redistribute, record, or commercially exploit
            content without permission. Do not harass others, upload unlawful material, or attempt
            to bypass security or payment controls.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">5. Intellectual property</h2>
          <p className="text-muted">
            U Learn branding, software, and licensed educational materials remain the property of U
            Learn and/or its teachers and licensors. Purchase or subscription does not transfer
            ownership of content.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">6. Privacy</h2>
          <p className="text-muted">
            How we collect and use personal data is described in our{" "}
            <Link className="text-accent hover:underline" href={`/${locale}/privacy`}>
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">7. Disclaimers</h2>
          <p className="text-muted">
            The service is provided “as is.” Educational outcomes are not guaranteed. To the fullest
            extent permitted by law, we disclaim warranties of merchantability, fitness for a
            particular purpose, and non-infringement. Apple is not responsible for the app or its
            content; for App Store purchases, Apple’s standard licensed application terms may also
            apply.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">8. Contact</h2>
          <p className="text-muted">
            Questions about these Terms:{" "}
            <Link className="text-accent hover:underline" href={`/${locale}/support`}>
              Support
            </Link>{" "}
            or email{" "}
            <a className="text-accent hover:underline" href="mailto:support@ulearn.usmart-iot.com">
              support@ulearn.usmart-iot.com
            </a>
            .
          </p>
        </section>

        <p className="text-sm text-muted">
          You may also review Apple’s standard Licensed Application End User License Agreement at{" "}
          <a
            className="text-accent hover:underline"
            href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
            target="_blank"
            rel="noopener noreferrer"
          >
            apple.com/legal/…/stdeula
          </a>
          .
        </p>
      </main>
    </div>
  );
}
