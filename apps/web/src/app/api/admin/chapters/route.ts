import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseService } from "@/services/course.service";

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const { subjectId, nameEn, nameAr, nameKu, nameTr, description, sortOrder } = body;

  if (!subjectId || !nameEn || !nameAr || !nameKu || !nameTr) {
    return error("Missing required fields", 422, "VALIDATION");
  }

  const chapter = await CourseService.createChapter(
    {
      subject: { connect: { id: subjectId } },
      nameEn,
      nameAr,
      nameKu,
      nameTr,
      description,
      sortOrder: sortOrder ?? 0,
    },
    auth.session.userId
  );

  return json({ chapter }, 201);
}
