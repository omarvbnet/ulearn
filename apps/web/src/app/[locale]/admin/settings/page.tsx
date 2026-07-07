import { PageHeader } from "@/components/ui";
import { SettingsClient } from "./settings-client";

export default function AdminSettingsPage() {
  return (
    <div>
      <PageHeader
        title="System Settings"
        description="Global subscription expiry, inactivity period, OTP configuration"
      />
      <SettingsClient />
    </div>
  );
}
