"use client";

import { Button, Card, PageHeader } from "@/components/ui";
import { EmptyState, SkeletonRows, useToast } from "@/components/overlay";
import { useT } from "@/i18n/client";
import { useCallback, useEffect, useState } from "react";

type Device = {
  id: string;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  lastSeenAt: string;
  isActive: boolean;
};

export default function StudentDevicesPage() {
  const t = useT();
  const { toast } = useToast();
  const [data, setData] = useState<{ devices: Device[]; limit: number } | null>(null);

  const load = useCallback(() => {
    fetch("/api/devices")
      .then((r) => (r.ok ? r.json() : { devices: [], limit: 1 }))
      .then(setData);
  }, []);

  useEffect(load, [load]);

  async function remove(id: string) {
    const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast(t.student.deviceRemoved);
      load();
    } else {
      toast("Failed", "error");
    }
  }

  const active = data?.devices.filter((d) => d.isActive) ?? [];

  return (
    <div>
      <PageHeader
        title={t.student.devicesTitle}
        description={data ? `${active.length} / ${data.limit} ${t.student.devicesUsed}` : ""}
      />

      {data === null ? (
        <SkeletonRows rows={3} />
      ) : data.devices.length === 0 ? (
        <EmptyState title={t.student.noDevices} hint={t.student.noDevicesHint} />
      ) : (
        <div className="stagger space-y-3">
          {data.devices.map((d) => (
            <Card key={d.id} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {d.deviceName || d.platform || d.deviceId.slice(0, 16)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {new Date(d.lastSeenAt).toLocaleString()}
                  {!d.isActive && ` · ${t.student.deviceInactive}`}
                </p>
              </div>
              {d.isActive && (
                <Button variant="outline" className="!py-2 text-sm" onClick={() => remove(d.id)}>
                  {t.student.removeDevice}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
