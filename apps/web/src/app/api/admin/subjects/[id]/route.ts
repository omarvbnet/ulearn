import { json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseService } from "@/services/course.service";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await request.json();
  const {
    nameEn,
    nameAr,
    nameKu,
    nameTr,
    description,
    isCertificateProgram,
    totalHours,
    sortOrder,
    isActive,
  } = body;

  const subject = await prisma.subject.update({
    where: { id },
    data: {
      nameEn,
      nameAr,
      nameKu,
      nameTr,
      description,
      isCertificateProgram,
      totalHours,
      sortOrder,
      isActive,
    },
  });

  return json({ subject });
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  await CourseService.softDelete("subject", id, auth.session.userId);
  return json({ ok: true });
}
