"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ULearnLogo } from "@/components/ulearn-logo";
import { useT } from "@/i18n/client";
import {
  buildInternationalPhone,
  getDefaultPhoneCountry,
  phoneCountriesIraqFirst,
} from "@/lib/phone-countries";

export default function LoginPage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const router = useRouter();
  const countries = useMemo(() => phoneCountriesIraqFirst(), []);
  const [countryIso, setCountryIso] = useState(getDefaultPhoneCountry().iso);
  const [national, setNational] = useState("");
  const [fullPhone, setFullPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selected =
    countries.find((c) => c.iso === countryIso) || getDefaultPhoneCountry();

  const errorMessages: Record<string, string> = {
    OTP_INVALID: t.auth.otpInvalid,
    OTP_EXPIRED_OR_INVALID: t.auth.otpExpired,
    OTP_MAX_ATTEMPTS: t.auth.tooManyAttempts,
    DEVICE_LIMIT_REACHED: t.auth.deviceLimitReached,
    ACCOUNT_SUSPENDED: t.auth.accountSuspended,
    ACCOUNT_REJECTED: t.auth.accountRejected,
    RATE_LIMITED: t.auth.tooManyAttempts,
  };

  const friendly = (codeOrMessage: string) =>
    errorMessages[codeOrMessage] ?? codeOrMessage;

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    const phone = buildInternationalPhone(selected.dial, national);
    if (phone.replace(/\D/g, "").length < 10) {
      setError(t.auth.phonePlaceholder);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setFullPhone(phone);
      setStep("otp");
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : "Failed to send OTP"));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      if (data.isNewUser) {
        router.push(`/${locale}/register?phone=${encodeURIComponent(fullPhone)}`);
        return;
      }

      if (data.isPending) {
        router.push(`/${locale}/pending`);
        return;
      }

      const role = data.user?.role;
      if (role === "SUPER_ADMIN" || role === "COUNTRY_ADMIN") {
        router.push(`/${locale}/admin`);
      } else if (role === "TEACHER") {
        router.push(`/${locale}/teacher`);
      } else {
        router.push(`/${locale}/student`);
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : "Verification failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="absolute end-6 top-6">
        <LanguageSwitcher locale={locale} />
      </div>

      <Card className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <ULearnLogo size={80} animated className="mb-4" />
          <h1 className="text-2xl font-bold glow-text">{t.brand}</h1>
          <p className="mt-2 text-sm text-muted">{t.auth.whatsappAuth}</p>
        </div>

        {step === "phone" ? (
          <form onSubmit={sendOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted">{t.auth.phone}</label>
              <div className="flex gap-2" dir="ltr">
                <select
                  className="input w-[10.5rem] shrink-0 px-2 text-sm"
                  value={countryIso}
                  onChange={(e) => setCountryIso(e.target.value)}
                  aria-label="Country code"
                >
                  {countries.map((c) => (
                    <option key={c.iso} value={c.iso}>
                      {c.flag} +{c.dial} {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  className="input flex-1"
                  placeholder={
                    selected.iso === "IQ" ? "7XX XXX XXXX" : "Phone number"
                  }
                  value={national}
                  onChange={(e) => setNational(e.target.value)}
                  required
                  dir="ltr"
                />
              </div>
              <p className="text-xs text-muted" dir="ltr">
                {buildInternationalPhone(selected.dial, national || "…")}
              </p>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t.auth.sending : t.auth.sendOtp}
            </Button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            <p className="text-sm text-muted">
              {t.auth.codeSentTo}{" "}
              <span className="text-foreground" dir="ltr">
                {fullPhone}
              </span>
            </p>
            <Input
              label={t.auth.verificationCode}
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              dir="ltr"
              className="text-center text-2xl tracking-[0.5em]"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
              {loading ? t.auth.verifying : t.auth.verify}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setStep("phone")}
            >
              {t.auth.changeNumber}
            </Button>
          </form>
        )}

        {process.env.NODE_ENV === "development" && (
          <p className="mt-6 text-center text-xs text-muted">
            Dev OTP: set DEV_OTP in .env (default logs to console)
          </p>
        )}
      </Card>
    </div>
  );
}
