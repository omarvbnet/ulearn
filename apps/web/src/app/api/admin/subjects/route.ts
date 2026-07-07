import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseService } from "@/services/course.service";

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const {
    countryId,
    stageId,
    nameEn,
    nameAr,
    nameKu,
    nameTr,
    description,
    isCertificateProgram,
    totalHours,
    sortOrder,
  } = body;

  if (!countryId || !nameEn || !nameAr || !nameKu || !nameTr) {
    return error("Missing required fields", 422, "VALIDATION");
  }

  const subject = await CourseService.createSubject(
    {
      country: { connect: { id: countryId } },
      ...(stageId ? { stage: { connect: { id: stageId } } } : {}),
      nameEn,
      nameAr,
      nameKu,
      nameTr,
      description,
      isCertificateProgram: isCertificateProgram ?? false,
      totalHours: totalHours ?? 0,
      sortOrder: sortOrder ?? 0,
    },
    auth.session.userId
  );

  return json({ subject }, 201);
}
