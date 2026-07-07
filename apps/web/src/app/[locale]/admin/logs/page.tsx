import { PageHeader } from "@/components/ui";
import { LogsClient } from "./logs-client";

export default function AdminLogsPage() {
  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Every sensitive action with actor, entity, and timestamp"
      />
      <LogsClient />
    </div>
  );
}
