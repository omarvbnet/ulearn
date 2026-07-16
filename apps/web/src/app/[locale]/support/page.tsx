import Link from "next/link";
import { getDictionary } from "@/i18n/config";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui";
import { ULearnLogo } from "@/components/ulearn-logo";
import { prisma } from "@/lib/prisma";

async function supportContact() {
  try {
    const row = await prisma.systemSetting.findFirst({
      where: { key: "support_whatsapp_phone", countryId: null },
    });
    const raw =
      row?.value == null
        ? ""
        : typeof row.value === "string"
          ? row.value
          : typeof row.value === "object" &&
              row.value !== null &&
              "phone" in (row.value as object)
            ? String((row.value as { phone?: unknown }).phone ?? "")
            : String(row.value);
    const digits = raw.replace(/\D/g, "");
    if (!digits) return { phone: null as string | null, whatsappUrl: null as string | null };
    const phone = digits.startsWith("00") ? digits.slice(2) : digits;
    return { phone: `+${phone}`, whatsappUrl: `https://wa.me/${phone}` };
  } catch {
    return { phone: null, whatsappUrl: null };
  }
}

export default async function PublicSupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const contact = await supportContact();

  return (
    <div className="relative min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href={`/${locale}`} className="flex items-center gap-3">
          <ULearnLogo size={40} />
          <span className="text-lg font-bold">{t.brand}</span>
        </Link>
        <LanguageSwitcher locale={locale} />
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24">
        <h1 className="text-3xl font-bold tracking-tight">Support</h1>
        <p className="mt-3 text-muted">
          Need help with U Learn accounts, courses, AI plans, or purchases? Contact us using the
          options below. We typically respond within 1–2 business days.
        </p>

        <section className="card mt-8 space-y-4 p-6 text-start">
          <h2 className="text-lg font-semibold text-accent">Contact support</h2>
          {contact.whatsappUrl ? (
            <>
              <p className="text-sm text-muted">
                Chat with U Learn support on WhatsApp
                {contact.phone ? ` (${contact.phone})` : ""}.
              </p>
              <a href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer">
                <Button>Message on WhatsApp</Button>
              </a>
            </>
          ) : (
            <p className="text-sm text-muted">
              WhatsApp support will appear here once configured. You can also email us below.
            </p>
          )}
          <div className="border-t border-card-border pt-4">
            <p className="text-sm font-medium">Email</p>
            <a
              className="text-sm text-accent underline-offset-2 hover:underline"
              href="mailto:support@ulearn.usmart-iot.com"
            >
              support@ulearn.usmart-iot.com
            </a>
          </div>
        </section>

        <section className="card mt-6 space-y-3 p-6 text-start">
          <h2 className="text-lg font-semibold text-accent">Common topics</h2>
          <ul className="list-disc space-y-2 ps-5 text-sm text-muted">
            <li>
              <strong className="text-foreground">Sign-in:</strong> Use WhatsApp OTP with your
              registered phone number.
            </li>
            <li>
              <strong className="text-foreground">AI subscription:</strong> Purchase monthly or yearly
              plans via Apple In-App Purchase / Google Play Billing inside the app (Upgrade Plan).
            </li>
            <li>
              <strong className="text-foreground">Course access:</strong> Paid courses unlock via
              in-app purchase or an admin activation code.
            </li>
            <li>
              <strong className="text-foreground">Restore purchases:</strong> Use Restore on the AI
              upgrade screen if a purchase did not unlock.
            </li>
            <li>
              <strong className="text-foreground">Account deletion:</strong> Profile → Delete account
              in the mobile app.
            </li>
          </ul>
        </section>

        <section className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link className="text-accent hover:underline" href={`/${locale}/privacy`}>
            Privacy Policy
          </Link>
          <Link className="text-accent hover:underline" href={`/${locale}`}>
            Home
          </Link>
          <Link className="text-accent hover:underline" href={`/${locale}/login`}>
            Login
          </Link>
        </section>
      </main>
    </div>
  );
}
