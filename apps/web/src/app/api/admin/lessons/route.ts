import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseService } from "@/services/course.service";

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const { chapterId, nameEn, nameAr, nameKu, nameTr, description, isFree, sortOrder } = body;

  if (!chapterId || !nameEn || !nameAr || !nameKu || !nameTr) {
    return error("Missing required fields", 422, "VALIDATION");
  }

  const lesson = await CourseService.createLesson(
    {
      chapter: { connect: { id: chapterId } },
      nameEn,
      nameAr,
      nameKu,
      nameTr,
      description,
      isFree: isFree ?? false,
      sortOrder: sortOrder ?? 0,
    },
    auth.session.userId
  );

  return json({ lesson }, 201);
}
