import Link from "next/link";
import { getDictionary } from "@/i18n/config";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ULearnLogo } from "@/components/ulearn-logo";

export default async function PublicPrivacyPage({
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
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted">Last updated: July 2026</p>

        <p className="text-muted">
          U Learn (“we”, “us”) operates an educational platform for students, certificate learners,
          and teachers. This Privacy Policy explains what personal data we collect, how we use it
          for teaching and payments, how long we keep it, and how you can delete your account.
        </p>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">1. Who we are</h2>
          <p className="text-muted">
            U Learn provides online courses, short videos, quizzes, subscriptions, AI learning tools,
            and related educational features. For privacy requests, use{" "}
            <Link className="text-accent hover:underline" href={`/${locale}/support`}>
              Support
            </Link>{" "}
            or email support@ulearn.usmart-iot.com.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">2. Data we collect</h2>
          <p className="text-muted">
            Depending on your role, we may collect: phone number (WhatsApp OTP sign-in), full name,
            national ID and ID image, parent contact details (for students), email, gender,
            country/province, educational stage or certificate interests, profile photo, device
            identifiers for device limits, app language, learning progress, quiz results, favorites,
            purchase and subscription records, support messages, and approximate location if you
            choose to share it during registration.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">3. How we use data</h2>
          <p className="text-muted">
            We use data to authenticate users, approve registrations, deliver courses and AI
            features, process purchases/subscriptions, prevent fraud, provide support, and improve
            the platform.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">4. Payments & subscriptions</h2>
          <p className="text-muted">
            Payment-related data (activation codes, subscription status, course purchases, and
            in-app purchase receipts where applicable) is used to unlock paid content and fulfill
            purchases. Apple and Google may process billing under their own policies; U Learn stores
            only what is needed to confirm entitlements.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">5. Sharing</h2>
          <p className="text-muted">
            We do not sell personal data. We may share data with service providers (hosting,
            messaging, analytics, payment platforms) under contracts, or when required by law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">6. Retention & deletion</h2>
          <p className="text-muted">
            You can request account deletion in the mobile app (Profile → Delete account) or via
            Support. Some records may be retained where legally required (for example purchase
            records).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">7. Contact</h2>
          <p className="text-muted">
            Privacy questions:{" "}
            <a className="text-accent hover:underline" href="mailto:support@ulearn.usmart-iot.com">
              support@ulearn.usmart-iot.com
            </a>{" "}
            or{" "}
            <Link className="text-accent hover:underline" href={`/${locale}/support`}>
              Support
            </Link>
            .
          </p>
        </section>

        <p className="pt-4 text-sm">
          <Link className="text-accent hover:underline" href={`/${locale}`}>
            ← Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}
