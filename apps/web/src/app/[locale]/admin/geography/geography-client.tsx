"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";

type Province = {
  id: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
};

type Country = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  provinces: Province[];
  _count: { educationalStages: number };
};

export function GeographyClient() {
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [countryForm, setCountryForm] = useState({
    code: "",
    nameEn: "",
    nameAr: "",
    nameKu: "",
    nameTr: "",
  });
  const [provinceForm, setProvinceForm] = useState({
    nameEn: "",
    nameAr: "",
    nameKu: "",
    nameTr: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/countries");
    const data = await res.json();
    setCountries(data.countries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addCountry(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/admin/countries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(countryForm),
    });
    setSaving(false);
    if (res.ok) {
      setCountryForm({ code: "", nameEn: "", nameAr: "", nameKu: "", nameTr: "" });
      load();
    }
  }

  async function addProvince(countryId: string, e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/admin/countries/${countryId}/provinces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(provinceForm),
    });
    setSaving(false);
    if (res.ok) {
      setProvinceForm({ nameEn: "", nameAr: "", nameKu: "", nameTr: "" });
      load();
    }
  }

  async function toggleCountry(id: string, isActive: boolean) {
    await fetch(`/api/admin/countries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    load();
  }

  async function deleteCountry(id: string) {
    if (!confirm("Delete this country?")) return;
    await fetch(`/api/admin/countries/${id}`, { method: "DELETE" });
    load();
  }

  async function deleteProvince(id: string) {
    if (!confirm("Delete this province?")) return;
    await fetch(`/api/admin/provinces/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Countries & Provinces</h1>
        <p className="text-muted">Manage geography used in registration, teachers, and notifications</p>
      </div>

      <Card className="mb-8">
        <h2 className="mb-4 font-semibold">Add country</h2>
        <form onSubmit={addCountry} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="Code" value={countryForm.code} onChange={(e) => setCountryForm({ ...countryForm, code: e.target.value })} placeholder="IQ" required />
          <Input label="Name (EN)" value={countryForm.nameEn} onChange={(e) => setCountryForm({ ...countryForm, nameEn: e.target.value })} required />
          <Input label="Name (AR)" value={countryForm.nameAr} onChange={(e) => setCountryForm({ ...countryForm, nameAr: e.target.value })} required />
          <Input label="Name (KU)" value={countryForm.nameKu} onChange={(e) => setCountryForm({ ...countryForm, nameKu: e.target.value })} required />
          <Input label="Name (TR)" value={countryForm.nameTr} onChange={(e) => setCountryForm({ ...countryForm, nameTr: e.target.value })} required />
          <div className="flex items-end">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Add country"}</Button>
          </div>
        </form>
      </Card>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="space-y-4">
          {(countries ?? []).map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{c.nameEn} <span className="text-muted">({c.code})</span></p>
                  <p className="text-sm text-muted">
                    {c.provinces.length} provinces · {c._count.educationalStages} stages
                    {!c.isActive && " · Inactive"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                    {expanded === c.id ? "Hide" : "Manage provinces"}
                  </Button>
                  <Button variant="outline" onClick={() => toggleCountry(c.id, c.isActive)}>
                    {c.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button variant="danger" onClick={() => deleteCountry(c.id)}>Delete</Button>
                </div>
              </div>

              {expanded === c.id && (
                <div className="mt-4 border-t border-card-border pt-4">
                  <ul className="mb-4 space-y-2">
                    {c.provinces.map((p) => (
                      <li key={p.id} className="flex items-center justify-between rounded-lg border border-card-border px-3 py-2 text-sm">
                        <span>{p.nameEn} / {p.nameAr}</span>
                        <button type="button" className="text-danger text-xs" onClick={() => deleteProvince(p.id)}>Delete</button>
                      </li>
                    ))}
                  </ul>
                  <form onSubmit={(e) => addProvince(c.id, e)} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Input label="Province EN" value={provinceForm.nameEn} onChange={(e) => setProvinceForm({ ...provinceForm, nameEn: e.target.value })} required />
                    <Input label="Province AR" value={provinceForm.nameAr} onChange={(e) => setProvinceForm({ ...provinceForm, nameAr: e.target.value })} required />
                    <Input label="Province KU" value={provinceForm.nameKu} onChange={(e) => setProvinceForm({ ...provinceForm, nameKu: e.target.value })} required />
                    <Input label="Province TR" value={provinceForm.nameTr} onChange={(e) => setProvinceForm({ ...provinceForm, nameTr: e.target.value })} required />
                    <div className="sm:col-span-2 lg:col-span-4">
                      <Button type="submit" disabled={saving}>Add province</Button>
                    </div>
                  </form>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
