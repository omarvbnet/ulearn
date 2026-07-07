"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";

type Country = {
  id: string;
  nameEn: string;
  nameAr: string;
  provinces: { id: string; nameEn: string; nameAr: string }[];
};

function RegisterForm() {
  const { locale } = useParams<{ locale: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const phone = searchParams.get("phone") || "";

  const [type, setType] = useState<"STUDENT" | "CERTIFICATE">("STUDENT");
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    fullLegalName: "",
    gender: "MALE",
    countryId: "",
    provinceId: "",
    email: "",
    nationalId: "",
    parentPhone: "",
    grade: "",
    schoolUniversity: "",
    educationalQualification: "",
    specialization: "",
    occupation: "",
  });

  useEffect(() => {
    fetch("/api/countries")
      .then((r) => r.json())
      .then((d) => setCountries(d.countries || []))
      .catch(() => {});
  }, []);

  const provinces =
    countries.find((c) => c.id === form.countryId)?.provinces ?? [];

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload =
        type === "STUDENT"
          ? {
              type,
              phone,
              ...form,
              locale: locale.toUpperCase(),
            }
          : {
              type,
              phone,
              fullLegalName: form.fullLegalName,
              gender: form.gender,
              countryId: form.countryId,
              provinceId: form.provinceId,
              email: form.email || undefined,
              nationalId: form.nationalId,
              educationalQualification: form.educationalQualification,
              specialization: form.specialization,
              occupation: form.occupation,
              locale: locale.toUpperCase(),
            };

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      router.push(`/${locale}/pending`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Card>
        <h1 className="mb-2 text-2xl font-bold">Create Account</h1>
        <p className="mb-6 text-sm text-muted" dir="ltr">
          Phone: {phone}
        </p>

        <div className="mb-6 grid grid-cols-2 gap-2">
          {(["STUDENT", "CERTIFICATE"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                type === t
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-card-border text-muted hover:border-accent/40"
              }`}
            >
              {t === "STUDENT" ? "Student" : "Experience Certificate"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="Full Legal Name"
              value={form.fullLegalName}
              onChange={(e) => set("fullLegalName", e.target.value)}
              required
            />
          </div>
          <Select
            label="Gender"
            value={form.gender}
            onChange={(e) => set("gender", e.target.value)}
          >
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </Select>
          <Input
            label="National ID"
            value={form.nationalId}
            onChange={(e) => set("nationalId", e.target.value)}
            required
          />
          <Select
            label="Country"
            value={form.countryId}
            onChange={(e) => {
              set("countryId", e.target.value);
              set("provinceId", "");
            }}
            required
          >
            <option value="">Select country</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEn}
              </option>
            ))}
          </Select>
          <Select
            label="Province"
            value={form.provinceId}
            onChange={(e) => set("provinceId", e.target.value)}
            required
          >
            <option value="">Select province</option>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameEn}
              </option>
            ))}
          </Select>
          <div className="sm:col-span-2">
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>

          {type === "STUDENT" ? (
            <>
              <Input
                label="Parent Phone"
                value={form.parentPhone}
                onChange={(e) => set("parentPhone", e.target.value)}
                required
                dir="ltr"
              />
              <Input
                label="Grade"
                value={form.grade}
                onChange={(e) => set("grade", e.target.value)}
              />
              <div className="sm:col-span-2">
                <Input
                  label="School / University"
                  value={form.schoolUniversity}
                  onChange={(e) => set("schoolUniversity", e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <Input
                label="Educational Qualification"
                value={form.educationalQualification}
                onChange={(e) => set("educationalQualification", e.target.value)}
              />
              <Input
                label="Specialization"
                value={form.specialization}
                onChange={(e) => set("specialization", e.target.value)}
              />
              <div className="sm:col-span-2">
                <Input
                  label="Occupation"
                  value={form.occupation}
                  onChange={(e) => set("occupation", e.target.value)}
                />
              </div>
            </>
          )}

          {error && (
            <p className="sm:col-span-2 text-sm text-danger">{error}</p>
          )}

          <div className="sm:col-span-2">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Submitting..." : "Submit Registration"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-muted">Loading...</div>}>
      <RegisterForm />
    </Suspense>
  );
}
