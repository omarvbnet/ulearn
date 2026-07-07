import { PageHeader } from "@/components/ui";
import { CourseManager } from "./course-manager";

export default function AdminCoursesPage() {
  return (
    <div>
      <PageHeader
        title="Courses & Content"
        description="Country → Stages → Subjects → Chapters → Lessons → Videos / Files"
      />
      <CourseManager />
    </div>
  );
}
