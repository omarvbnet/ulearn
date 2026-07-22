import { TeacherRegisterPage } from "@/components/teacher-register-form";

export const metadata = { title: "Teacher registration" };

export default function RegisterTeacherPage() {
  return <TeacherRegisterPage track="SCHOOL" />;
}
