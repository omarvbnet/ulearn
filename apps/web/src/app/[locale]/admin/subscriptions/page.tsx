import { PageHeader } from "@/components/ui";
import { SubscriptionsClient } from "./subscriptions-client";

export default function AdminSubscriptionsPage() {
  return (
    <div>
      <PageHeader
        title="Subscriptions"
        description="Activation requests, packages, and code generation"
      />
      <SubscriptionsClient />
    </div>
  );
}
