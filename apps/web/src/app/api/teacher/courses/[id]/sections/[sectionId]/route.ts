import { error, json, requireAuth } from "@/lib/api";
import { CourseSectionService } from "@/services/course-section.service";
import {
  findEditableCourse,
  TEACHER_COURSE_ROLES,
} from "@/lib/teacher-course-access";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(1).max(120),
});

/** Teacher: rename a section. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id, sectionId } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id, {
    id: true,
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await CourseSectionService.update(id, sectionId, parsed.data.title);
  if (!result.success) return error("Section not found", 404, "NOT_FOUND");
  return json({ section: result.section });
}

/** Teacher: delete an empty section. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id, sectionId } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id, {
    id: true,
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const result = await CourseSectionService.remove(id, sectionId);
  if (!result.success) {
    if (result.error === "SECTION_NOT_EMPTY") {
      return error("Move or delete lessons in this section first", 400, result.error);
    }
    return error("Section not found", 404, "NOT_FOUND");
  }
  return json({ success: true });
}
