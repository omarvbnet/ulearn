import { TeacherRegisterPage } from "@/components/teacher-register-form";

export const metadata = { title: "Certificate teacher registration" };

export default function RegisterCertificateTeacherPage() {
  return <TeacherRegisterPage track="CERTIFICATE" />;
}
