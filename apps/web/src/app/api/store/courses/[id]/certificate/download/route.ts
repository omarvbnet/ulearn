import { error, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { CourseCertificateService } from "@/services/course-certificate.service";

/** Download the professional course certificate PDF. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  if (!user) return error("Unauthorized", 401);

  const { id } = await params;
  const result = await CourseCertificateService.getPdfBytes(user.id, id);
  if (!result.success) {
    const status =
      result.error === "COURSE_INCOMPLETE" || result.error === "NO_ACCESS"
        ? 403
        : result.error === "COURSE_NOT_FOUND"
          ? 404
          : 400;
    return error(result.error ?? "Unable to generate certificate", status, result.error);
  }

  return new Response(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
