import { PageHeader } from "@/components/ui";
import { QuestionsClient } from "./questions-client";

export default function TeacherQuestionsPage() {
  return (
    <div>
      <PageHeader
        title="Student Questions"
        description="Answer questions from lessons — students are notified instantly"
      />
      <QuestionsClient />
    </div>
  );
}
