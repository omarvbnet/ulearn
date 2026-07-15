import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseGroupService } from "@/services/course-group.service";
import { z } from "zod";

const patchSchema = z.object({
  titleEn: z.string().min(1).max(200).optional(),
  titleAr: z.string().max(200).nullable().optional(),
  titleKu: z.string().max(200).nullable().optional(),
  titleTr: z.string().max(200).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  coverKey: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  stageId: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  courseIds: z.array(z.string()).min(1).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  const group = await CourseGroupService.getAdmin(id);
  if (!group) return error("Not found", 404, "NOT_FOUND");
  return json({ group });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await CourseGroupService.update(id, {
    ...parsed.data,
    actorId: auth.session.userId,
  });
  if (!result.success) return error(result.error, 400, result.error);
  return json({ group: result.group });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  const result = await CourseGroupService.softDelete(id, auth.session.userId);
  if (!result.success) return error(result.error, 400, result.error);
  return json({ success: true });
}
