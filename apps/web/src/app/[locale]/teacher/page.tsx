import { Card, PageHeader, StatCard } from "@/components/ui";

export default function TeacherDashboardPage() {
  return (
    <div>
      <PageHeader
        title="Teacher Dashboard"
        description="Students, ratings, complaints, Q&A, and analytics"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Students" value="—" />
        <StatCard label="Courses" value="—" />
        <StatCard label="Open Questions" value="—" />
        <StatCard label="Avg Rating" value="—" />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="font-semibold">Q&A</h3>
          <p className="mt-2 text-sm text-muted">
            Reply to student questions with optional file attachments. Students are notified when
            you answer.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">Notifications</h3>
          <p className="mt-2 text-sm text-muted">
            Receive email and in-app notifications when students ask questions on your lessons.
          </p>
        </Card>
      </div>
    </div>
  );
}
