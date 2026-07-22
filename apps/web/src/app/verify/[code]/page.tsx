import { CertificateService } from "@/services/certificate.service";
import { CourseCertificateService } from "@/services/course-certificate.service";
import { ULearnLogo } from "@/components/ulearn-logo";

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const subjectCert = await CertificateService.verify(code);
  const courseCert = subjectCert
    ? null
    : await CourseCertificateService.verify(code);

  const cert = subjectCert
    ? {
        userName: subjectCert.userName,
        courseName: subjectCert.courseName,
        completionDate: subjectCert.completionDate,
        certificateNumber: subjectCert.certificateNumber,
        totalHours: subjectCert.totalHours,
        teacherName: null as string | null,
      }
    : courseCert
      ? {
          userName: courseCert.userName,
          courseName: courseCert.courseTitle,
          completionDate: courseCert.completionDate,
          certificateNumber: courseCert.certificateNumber,
          totalHours: courseCert.totalHours,
          teacherName: courseCert.teacherName,
        }
      : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-grid px-4">
      <div className="card w-full max-w-lg p-8 text-center">
        <ULearnLogo size={64} className="mx-auto mb-4" />
        <h1 className="text-xl font-bold">Certificate Verification</h1>
        {cert ? (
          <div className="mt-6 space-y-2 text-start text-sm">
            <p>
              <span className="text-muted">Name:</span> {cert.userName}
            </p>
            <p>
              <span className="text-muted">Course:</span> {cert.courseName}
            </p>
            {cert.teacherName ? (
              <p>
                <span className="text-muted">Instructor:</span> {cert.teacherName}
              </p>
            ) : null}
            <p>
              <span className="text-muted">Date:</span>{" "}
              {cert.completionDate.toLocaleDateString()}
            </p>
            <p>
              <span className="text-muted">Certificate #:</span> {cert.certificateNumber}
            </p>
            <p>
              <span className="text-muted">Hours:</span> {cert.totalHours}
            </p>
            <div className="mt-4 rounded-lg bg-success/15 px-4 py-2 text-center text-success">
              Valid Certificate
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-lg bg-danger/15 px-4 py-2 text-danger">
            Certificate not found
          </div>
        )}
      </div>
    </div>
  );
}
