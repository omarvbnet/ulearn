import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { CourseGroupService } from "@/services/course-group.service";
import { z } from "zod";

const createSchema = z.object({
  titleEn: z.string().min(1).max(200),
  titleAr: z.string().max(200).optional(),
  titleKu: z.string().max(200).optional(),
  titleTr: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  coverKey: z.string().optional(),
  coverUrl: z.string().optional(),
  stageId: z.string().min(1),
  countryId: z.string().optional(),
  currency: z.string().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  courseIds: z.array(z.string()).min(1),
});

export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const stageId = new URL(request.url).searchParams.get("stageId") || undefined;
  const groups = await CourseGroupService.listAdmin(stageId);
  return json({ groups });
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await CourseGroupService.create({
    ...parsed.data,
    actorId: auth.session.userId,
  });
  if (!result.success) return error(result.error, 400, result.error);
  return json({ group: result.group }, 201);
}
