import { error, json, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { CourseCertificateService } from "@/services/course-certificate.service";

/** Certificate lock/unlock status for a store course (CERTIFICATE_USER). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  if (!user) return error("Unauthorized", 401);

  const { id } = await params;
  const status = await CourseCertificateService.getStatus(
    user.id,
    id,
    user.role
  );
  return json(status);
}

/** Claim / generate the course certificate once unlocked. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  if (!user) return error("Unauthorized", 401);

  const { id } = await params;
  const result = await CourseCertificateService.claim(user.id, id, user.id);
  if (!result.success) {
    const status =
      result.error === "COURSE_INCOMPLETE" || result.error === "NO_ACCESS"
        ? 403
        : result.error === "COURSE_NOT_FOUND"
          ? 404
          : 400;
    return error(result.error, status, result.error);
  }
  return json({ certificate: result.certificate });
}
