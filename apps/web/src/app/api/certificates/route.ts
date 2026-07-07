import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { CertificateService } from "@/services/certificate.service";

/** Earned certificates + progress toward claimable certificate programs. */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  if (!user) return error("Unauthorized", 401);

  const certificates = await CertificateService.getUserCertificates(user.id);

  const programs = await prisma.subject.findMany({
    where: {
      isCertificateProgram: true,
      deletedAt: null,
      isActive: true,
      ...(user.countryId ? { countryId: user.countryId } : {}),
    },
    select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true, totalHours: true },
  });

  const earnedSubjectIds = new Set(certificates.map((c) => c.subjectId));
  const progress = await Promise.all(
    programs
      .filter((p) => !earnedSubjectIds.has(p.id))
      .map(async (p) => {
        const eligibility = await CertificateService.checkEligibility(user.id, p.id);
        return { subject: p, ...eligibility };
      })
  );

  return json({ certificates, programs: progress });
}

/** Claim a certificate for a completed program. */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { subjectId } = (await request.json()) as { subjectId?: string };
  if (!subjectId) return error("subjectId is required", 422, "VALIDATION");

  const result = await CertificateService.generate(auth.session.userId, subjectId);
  if (!result.success) {
    return error(result.error ?? "Not eligible", 403, result.error);
  }

  return json({ certificate: result.certificate }, 201);
}
