"use client";

import { Button, Card, PageHeader } from "@/components/ui";
import { EmptyState, SkeletonRows } from "@/components/overlay";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { useCallback, useEffect, useState } from "react";

type Item = {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
};

export default function StudentNotificationsPage() {
  const t = useT();
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications");
    if (res.ok) {
      const d = await res.json();
      setItems(d.notifications);
      setUnread(d.unread);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id?: string) {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }),
    });
    load();
  }

  return (
    <div>
      <PageHeader
        title={t.nav.notifications}
        description={unread > 0 ? `${unread} ${t.student.unread}` : t.student.allCaughtUp}
        actions={
          unread > 0 ? (
            <Button variant="outline" onClick={() => markRead()}>
              {t.student.markAllRead}
            </Button>
          ) : undefined
        }
      />

      {items === null ? (
        <SkeletonRows rows={5} />
      ) : items.length === 0 ? (
        <EmptyState title={t.student.noNotifications} />
      ) : (
        <div className="stagger space-y-3">
          {items.map((n) => (
            <Card
              key={n.id}
              className={cn(
                "cursor-pointer p-4 transition",
                !n.isRead && "border-accent/40 bg-accent/[0.04]"
              )}
            >
              <button className="w-full text-start" onClick={() => !n.isRead && markRead(n.id)}>
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 font-semibold">
                    {!n.isRead && <span className="h-2 w-2 rounded-full bg-accent" />}
                    {n.title}
                  </p>
                  <span className="shrink-0 text-xs text-muted">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{n.body}</p>
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
