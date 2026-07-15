"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import Link from "next/link";

type Country = {
  id: string;
  nameEn: string;
  nameAr: string;
  provinces: { id: string; nameEn: string; nameAr: string }[];
};

type SubjectOpt = {
  id: string;
  nameEn: string;
  nameAr: string;
};

type Track = "SCHOOL" | "CERTIFICATE";

function TeacherRegisterForm({ track }: { track: Track }) {
  const { locale } = useParams<{ locale: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const phone = searchParams.get("phone") || "";
  const isRtl = locale === "ar" || locale === "ku";
  const isCert = track === "CERTIFICATE";

  const [countries, setCountries] = useState<Country[]>([]);
  const [subjects, setSubjects] = useState<SubjectOpt[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
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
    bio: "",
  });

  const maxSubjects = isCert ? 5 : 3;
  const title = isCert
    ? isRtl
      ? "طلب انضمام معلّم دورات الشهادات"
      : "Certificate courses teacher application"
    : isRtl
      ? "طلب انضمام معلّم دورات مدرسية"
      : "School courses teacher application";

  const subtitle = isCert
    ? isRtl
      ? "اختر مجالات الاهتمام نفسها المتاحة لمتعلمين الشهادات. بعد موافقة الإدارة يمكنك تسجيل الدخول بالتطبيق."
      : "Choose the same insights available to certificate learners. After admin approval you can sign in with your phone."
    : isRtl
      ? "اختر تخصصاتك التدريسية. بعد موافقة الإدارة يمكنك تسجيل الدخول بالتطبيق."
      : "Choose your teaching specialties. After admin approval you can sign in with your phone.";

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
    const url = isCert
      ? `/api/certificate-interests?countryId=${form.countryId}`
      : `/api/subjects/specialties?countryId=${form.countryId}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        setSubjects(d.interests || d.specialties || d.subjects || []);
        setSelected([]);
      })
      .catch(() => setSubjects([]));
  }, [form.countryId, isCert]);

  const provinces =
    countries.find((c) => c.id === form.countryId)?.provinces ?? [];

  function toggleSubject(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= maxSubjects) return prev;
      return [...prev, id];
    });
  }

  async function uploadId(file: File) {
    setUploadingId(true);
    setError("");
    try {
      const presign = await fetch("/api/auth/register/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      if (!presign.ok) throw new Error((await presign.json()).error || "Upload failed");
      const { uploadUrl, publicUrl, key } = await presign.json();
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed");
      const url =
        (typeof publicUrl === "string" && publicUrl.startsWith("http")
          ? publicUrl
          : null) ||
        `/api/media/${String(key)
          .split("/")
          .map((p: string) => encodeURIComponent(p))
          .join("/")}`;
      setNationalIdImage(url);
      setIdFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ID upload failed");
    } finally {
      setUploadingId(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone) {
      setError(isRtl ? "رقم الهاتف مطلوب — ابدأ من صفحة تسجيل الدخول" : "Phone is required — start from the login page");
      return;
    }
    if (!nationalIdImage) {
      setError(isRtl ? "يرجى رفع صورة الهوية" : "Please upload your national ID photo");
      return;
    }
    if (selected.length < 1) {
      setError(
        isCert
          ? isRtl
            ? "اختر من 1 إلى 5 مجالات اهتمام"
            : "Select 1–5 insights"
          : isRtl
            ? "اختر من 1 إلى 3 تخصصات"
            : "Select 1–3 specialties"
      );
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: isCert ? "TEACHER_CERTIFICATE" : "TEACHER_SCHOOL",
          phone,
          fullLegalName: form.fullLegalName,
          gender: form.gender,
          countryId: form.countryId,
          provinceId: form.provinceId,
          email: form.email || undefined,
          nationalId: form.nationalId,
          nationalIdImage,
          bio: form.bio || undefined,
          subjectIds: selected,
          locale: locale.toUpperCase() === "EN" ? "EN" : locale.toUpperCase() === "KU" ? "KU" : locale.toUpperCase() === "TR" ? "TR" : "AR",
        }),
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
    <div className="mx-auto max-w-xl px-4 py-10" dir={isRtl ? "rtl" : "ltr"}>
      <Card className="space-y-6 p-6">
        <div>
          <p className="text-sm text-muted">
            <Link href={`/${locale}/login`} className="text-accent hover:underline">
              {isRtl ? "← العودة لتسجيل الدخول" : "← Back to login"}
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-muted">{subtitle}</p>
          {phone && (
            <p className="mt-2 text-sm" dir="ltr">
              {phone}
            </p>
          )}
        </div>

        {!phone && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {isRtl
              ? "افتح هذه الصفحة بعد التحقق من رقم هاتفك عبر صفحة تسجيل الدخول."
              : "Open this page after verifying your phone on the login screen."}
          </p>
        )}

        <form onSubmit={submit} className="space-y-4">
          <Input
            label={isRtl ? "الاسم الكامل" : "Full legal name"}
            value={form.fullLegalName}
            onChange={(e) => setForm((f) => ({ ...f, fullLegalName: e.target.value }))}
            required
          />
          <Select
            label={isRtl ? "الجنس" : "Gender"}
            value={form.gender}
            onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
          >
            <option value="MALE">{isRtl ? "ذكر" : "Male"}</option>
            <option value="FEMALE">{isRtl ? "أنثى" : "Female"}</option>
          </Select>
          <Select
            label={isRtl ? "الدولة" : "Country"}
            value={form.countryId}
            onChange={(e) =>
              setForm((f) => ({ ...f, countryId: e.target.value, provinceId: "" }))
            }
          >
            <option value="">{isRtl ? "اختر" : "Select"}</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {isRtl ? c.nameAr || c.nameEn : c.nameEn}
              </option>
            ))}
          </Select>
          <Select
            label={isRtl ? "المحافظة" : "Province"}
            value={form.provinceId}
            onChange={(e) => setForm((f) => ({ ...f, provinceId: e.target.value }))}
            required
          >
            <option value="">{isRtl ? "اختر" : "Select"}</option>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {isRtl ? p.nameAr || p.nameEn : p.nameEn}
              </option>
            ))}
          </Select>
          <Input
            label={isRtl ? "البريد (اختياري)" : "Email (optional)"}
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <Input
            label={isRtl ? "رقم الهوية الوطنية" : "National ID"}
            value={form.nationalId}
            onChange={(e) => setForm((f) => ({ ...f, nationalId: e.target.value }))}
            required
          />
          <div>
            <label className="mb-1 block text-sm text-muted">
              {isRtl ? "صورة الهوية" : "National ID photo"}
            </label>
            <input
              type="file"
              accept="image/*"
              disabled={uploadingId}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadId(f);
              }}
              className="block w-full text-sm"
            />
            {idFileName && (
              <p className="mt-1 text-xs text-accent">
                {isRtl ? "تم الرفع: " : "Uploaded: "}
                {idFileName}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">
              {isRtl ? "نبذة (اختياري)" : "Bio (optional)"}
            </label>
            <textarea
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              rows={3}
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">
              {isCert
                ? isRtl
                  ? `مجالات الاهتمام (1–${maxSubjects})`
                  : `Insights (1–${maxSubjects})`
                : isRtl
                  ? `التخصصات (1–${maxSubjects})`
                  : `Specialties (1–${maxSubjects})`}
            </p>
            <div className="flex flex-wrap gap-2">
              {subjects.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSubject(s.id)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      on
                        ? "bg-accent text-white"
                        : "border border-border bg-surface-2 text-foreground"
                    }`}
                  >
                    {isRtl ? s.nameAr || s.nameEn : s.nameEn}
                  </button>
                );
              })}
              {subjects.length === 0 && (
                <p className="text-sm text-muted">
                  {isRtl ? "لا توجد خيارات لهذا البلد" : "No options for this country"}
                </p>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" disabled={loading || !phone}>
            {loading
              ? isRtl
                ? "جاري الإرسال…"
                : "Submitting…"
              : isRtl
                ? "إرسال الطلب"
                : "Submit application"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted">
          {isCert ? (
            <Link href={`/${locale}/register/teacher`} className="text-accent hover:underline">
              {isRtl ? "التقديم كمعلّم دورات مدرسية" : "Apply as a school courses teacher"}
            </Link>
          ) : (
            <Link
              href={`/${locale}/register/teacher/certificate`}
              className="text-accent hover:underline"
            >
              {isRtl
                ? "التقديم كمعلّم دورات الشهادات"
                : "Apply as a certificate courses teacher"}
            </Link>
          )}
        </p>
      </Card>
    </div>
  );
}

export function TeacherRegisterPage({ track }: { track: Track }) {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted">Loading…</div>}>
      <TeacherRegisterForm track={track} />
    </Suspense>
  );
}
