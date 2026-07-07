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
  const { nameEn, nameAr, nameKu, nameTr, description, isFree, sortOrder, isActive } = body;

  const lesson = await prisma.lesson.update({
    where: { id },
    data: { nameEn, nameAr, nameKu, nameTr, description, isFree, sortOrder, isActive },
  });

  return json({ lesson });
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  await CourseService.softDelete("lesson", id, auth.session.userId);
  return json({ ok: true });
}
