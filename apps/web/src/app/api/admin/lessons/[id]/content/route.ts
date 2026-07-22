import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseService } from "@/services/course.service";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await request.json();
  const { type, fileKey, fileUrl, fileSize, mimeType, durationSec, titleEn, titleAr, titleKu, titleTr } = body;

  if (!type || !fileKey) {
    return error("type and fileKey are required", 422, "VALIDATION");
  }

  const item = await CourseService.addContent(
    id,
    { type, fileKey, fileUrl, fileSize, mimeType, durationSec, titleEn, titleAr, titleKu, titleTr },
    auth.session.userId
  );

  return json({ content: item }, 201);
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  await params;
  const { searchParams } = new URL(request.url);
  const contentId = searchParams.get("contentId");
  if (!contentId) return error("contentId is required", 422, "VALIDATION");

  await prisma.lessonContent.update({
    where: { id: contentId },
    data: { deletedAt: new Date() },
  });

  return json({ ok: true });
}
