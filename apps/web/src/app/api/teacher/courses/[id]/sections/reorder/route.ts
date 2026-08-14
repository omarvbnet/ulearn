import { error, json, requireAuth } from "@/lib/api";
import { CourseSectionService } from "@/services/course-section.service";
import {
  findEditableCourse,
  TEACHER_COURSE_ROLES,
} from "@/lib/teacher-course-access";
import { z } from "zod";

const schema = z.object({
  sectionIds: z.array(z.string().min(1)).min(1),
});

/** Teacher: reorder sections. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id, {
    id: true,
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await CourseSectionService.reorder(id, parsed.data.sectionIds);
  if (!result.success) return error("Invalid section list", 422, "INVALID_SECTIONS");
  return json({ success: true });
}
