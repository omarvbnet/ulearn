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

type Stage = {
  id: string;
  nameEn: string;
  nameAr: string;
};

type Interest = {
  id: string;
  nameEn: string;
  nameAr: string;
};

function RegisterForm() {
  const { locale } = useParams<{ locale: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const phone = searchParams.get("phone") || "";
  const isAr = locale === "ar" || locale === "ku";

  const [type, setType] = useState<"STUDENT" | "CERTIFICATE">("STUDENT");
  const [countries, setCountries] = useState<Country[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingId, setUploadingId] = useState(false);
  const [error, setError] = useState("");
  const [nationalIdImage, setNationalIdImage] = useState("");
  const [idFileName, setIdFileName] = useState("");
  const [form, setForm] = useState({
    fullLegalName: "",
    gender: "MALE",
    countryId: "",
    provinceId: "",
    email: "",
    nationalId: "",
    parentPhone: "",
    parentEmail: "",
    educationalStageId: "",
    grade: "",
    schoolUniversity: "",
    educationalQualification: "",
    specialization: "",
    occupation: "",
  });

  useEffect(() => {
    fetch("/api/countries")
      .then((r) => r.json())
      .then((d) => {
        const list = d.countries || [];
        setCountries(list);
        if (list[0]?.id) {
          setForm((f) => ({ ...f, countryId: list[0].id }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.countryId) return;
    fetch(`/api/stages?countryId=${form.countryId}`)
      .then((r) => r.json())
      .then((d) => setStages(d.stages || []))
      .catch(() => setStages([]));
    fetch(`/api/certificate-interests?countryId=${form.countryId}`)
      .then((r) => r.json())
      .then((d) => setInterests(d.interests || []))
      .catch(() => setInterests([]));
  }, [form.countryId]);

  const provinces =
    countries.find((c) => c.id === form.countryId)?.provinces ?? [];

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleInterest(id: string) {
    setSelectedInterests((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  }

  async function uploadId(file: File) {
    setUploadingId(true);
    setError("");
    try {
      const presignRes = await fetch("/api/auth/register/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          filename: file.name,
          contentType: file.type || "image/jpeg",
          size: file.size,
        }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || "Upload failed");

      const putRes = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload failed");

      setNationalIdImage(presign.publicUrl || presign.uploadUrl);
      setIdFileName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ID upload failed");
    } finally {
      setUploadingId(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nationalIdImage) {
      setError("Please attach your national ID image");
      return;
    }
    if (type === "STUDENT" && !form.educationalStageId) {
      setError("Please select your educational stage");
      return;
    }
    if (type === "STUDENT") {
      const parentPhone = form.parentPhone.trim();
      if (parentPhone.length < 8) {
        setError("Parent phone is required (at least 8 digits).");
        return;
      }
      const parentEmail = form.parentEmail.trim();
      if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
        setError("Parent email is invalid. Leave it blank or enter a valid email.");
        return;
      }
    }
    if (type === "CERTIFICATE" && selectedInterests.length < 1) {
      setError("Please select at least one area of interest");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const payload =
        type === "STUDENT"
          ? {
              type,
              phone,
              ...form,
              parentPhone: form.parentPhone.trim(),
              parentEmail: form.parentEmail.trim() || undefined,
              nationalIdImage,
              email: form.email.trim() || undefined,
              locale: locale.toUpperCase(),
            }
          : {
              type,
              phone,
              fullLegalName: form.fullLegalName,
              gender: form.gender,
              countryId: form.countryId,
              provinceId: form.provinceId,
              email: form.email.trim() || undefined,
              nationalId: form.nationalId,
              nationalIdImage,
              educationalQualification: form.educationalQualification,
              specialization: form.specialization,
              occupation: form.occupation,
              interestSubjectIds: selectedInterests,
              locale: locale.toUpperCase(),
            };

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        const detailMsg = Array.isArray(data.details)
          ? data.details
              .map((d: { path?: string; message?: string }) => d.message)
              .filter(Boolean)
              .join(" ")
          : "";
        throw new Error(data.error || detailMsg || "Registration failed");
      }
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

        <p className="mb-6 text-center text-xs text-muted">
          Teachers apply separately:{" "}
          <a
            href={`/${locale}/register/teacher?phone=${encodeURIComponent(phone)}`}
            className="text-accent hover:underline"
          >
            School
          </a>
          {" · "}
          <a
            href={`/${locale}/register/teacher/certificate?phone=${encodeURIComponent(phone)}`}
            className="text-accent hover:underline"
          >
            Certificate courses
          </a>
        </p>

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
              set("educationalStageId", "");
            }}
            required
          >
            <option value="">Select country</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {isAr ? c.nameAr : c.nameEn}
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
                {isAr ? p.nameAr : p.nameEn}
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

          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium">National ID Image *</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="block w-full text-sm text-muted file:me-4 file:rounded-lg file:border-0 file:bg-primary/20 file:px-4 file:py-2 file:text-sm file:font-medium"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadId(file);
              }}
            />
            {uploadingId && <p className="mt-2 text-sm text-muted">Uploading…</p>}
            {nationalIdImage && (
              <p className="mt-2 text-sm text-green-400">✓ {idFileName || "ID uploaded"}</p>
            )}
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
                label="Parent Email (quiz results)"
                type="email"
                value={form.parentEmail}
                onChange={(e) => set("parentEmail", e.target.value)}
                dir="ltr"
              />
              <div className="sm:col-span-2">
                <Select
                  label="Educational Stage *"
                  value={form.educationalStageId}
                  onChange={(e) => set("educationalStageId", e.target.value)}
                  required
                >
                  <option value="">Select stage</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {isAr ? s.nameAr : s.nameEn}
                    </option>
                  ))}
                </Select>
              </div>
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
              <div className="sm:col-span-2">
                <p className="mb-2 text-sm font-medium">
                  Areas of Interest * (select 1–5)
                </p>
                <div className="flex flex-wrap gap-2">
                  {interests.map((i) => {
                    const on = selectedInterests.includes(i.id);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => toggleInterest(i.id)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                          on
                            ? "border-primary bg-primary/20 text-foreground"
                            : "border-card-border text-muted hover:border-accent/40"
                        }`}
                      >
                        {isAr ? i.nameAr : i.nameEn}
                      </button>
                    );
                  })}
                </div>
                {!interests.length ? (
                  <p className="mt-2 text-xs text-muted">
                    No interest areas available for this country yet.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted">
                    {selectedInterests.length}/5 selected
                  </p>
                )}
              </div>
              <Input
                label="Educational Qualification"
                value={form.educationalQualification}
                onChange={(e) => set("educationalQualification", e.target.value)}
              />
              <Input
                label="Specialization (optional)"
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
            <Button type="submit" className="w-full" disabled={loading || uploadingId}>
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
