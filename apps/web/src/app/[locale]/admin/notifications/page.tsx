import { PageHeader } from "@/components/ui";
import { NotificationsClient } from "./notifications-client";

export default function AdminNotificationsPage() {
  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Broadcast localized messages via push, email, and in-app channels"
      />
      <NotificationsClient />
    </div>
  );
}
