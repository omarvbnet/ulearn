import { PageHeader } from "@/components/ui";
import { TeachersClient } from "./teachers-client";

export default function AdminTeachersPage() {
  return (
    <div>
      <PageHeader
        title="Teachers"
        description="Add teachers, assign subjects, countries, and provinces"
      />
      <TeachersClient />
    </div>
  );
}
