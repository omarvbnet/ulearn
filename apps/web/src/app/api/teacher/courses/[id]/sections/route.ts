import { error, json, requireAuth } from "@/lib/api";
import { CourseSectionService } from "@/services/course-section.service";
import {
  findEditableCourse,
  TEACHER_COURSE_ROLES,
} from "@/lib/teacher-course-access";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1).max(120),
});

/** Teacher: list course sections. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id, {
    id: true,
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const sections = await CourseSectionService.list(id);
  return json({ sections });
}

/** Teacher: add a section. */
export async function POST(
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

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await CourseSectionService.create(id, parsed.data.title);
  if (!result.success) {
    if (result.error === "SECTIONS_DISABLED") {
      return error("This course uses a flat lesson list", 400, result.error);
    }
    return error(result.error, 400, result.error);
  }
  return json({ section: result.section });
}
