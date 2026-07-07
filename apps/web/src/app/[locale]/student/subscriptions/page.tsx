"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { getLocalizedField } from "@/lib/utils";

type Package = {
  id: string;
  nameEn: string;
  nameAr?: string;
  nameKu?: string;
  nameTr?: string;
  price: string;
  currency?: string;
  deviceLimit: number;
  type: string;
};

export default function StudentSubscriptionsPage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const [packages, setPackages] = useState<Package[]>([]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/subscriptions")
      .then((r) => (r.ok ? r.json() : { packages: [] }))
      .then((d) => setPackages(d.packages || []));
  }, []);

  async function request(packageId: string) {
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId }),
    });
    const data = await res.json();
    setMessage(res.ok ? t.student.requestSubmitted : data.error);
  }

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/subscriptions/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    setMessage(res.ok ? t.student.activated : data.error);
  }

  return (
    <div>
      <PageHeader title={t.nav.subscriptions} description={t.student.packagesDescription} />

      <Card className="mb-6">
        <h2 className="mb-4 font-semibold">{t.student.activateCode}</h2>
        <form onSubmit={activate} className="flex flex-wrap gap-3">
          <Input
            placeholder="XXXX-XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="max-w-xs"
            dir="ltr"
          />
          <Button type="submit">{t.common.activate}</Button>
        </form>
        {message && <p className="mt-3 text-sm text-accent">{message}</p>}
      </Card>

      <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {packages.map((pkg) => (
          <Card key={pkg.id} className="card-hover">
            <Badge status="ACTIVE">{pkg.type}</Badge>
            <h3 className="mt-3 text-lg font-semibold">
              {getLocalizedField(pkg, "name", locale)}
            </h3>
            <p className="mt-2 text-2xl font-bold glow-text">
              {Number(pkg.price).toLocaleString()} {pkg.currency ?? "IQD"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {pkg.deviceLimit} {t.student.devices}
            </p>
            <Button className="mt-4 w-full" onClick={() => request(pkg.id)}>
              {t.student.requestActivation}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
