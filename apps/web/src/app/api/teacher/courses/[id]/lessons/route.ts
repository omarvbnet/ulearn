import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

async function ownCourse(userId: string, courseId: string) {
  return prisma.course.findFirst({
    where: { id: courseId, deletedAt: null, teacher: { userId, deletedAt: null } },
  });
}

const lessonSchema = z.object({
  title: z.string().min(1),
  fileKey: z.string().optional(),
  fileUrl: z.string().optional(),
  thumbnailKey: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().int().optional(),
  sortOrder: z.number().int().optional(),
  isFreePreview: z.boolean().optional(),
});

/** Teacher: add a lesson to own course. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await ownCourse(auth.session.userId, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const parsed = lessonSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  // Students may sample at most 2 free preview videos per paid course.
  if (parsed.data.isFreePreview) {
    const previews = await prisma.courseLesson.count({
      where: { courseId: id, isFreePreview: true },
    });
    if (previews >= 2) {
      return error("A course can have at most 2 free preview lessons", 400, "FREE_PREVIEW_LIMIT");
    }
  }

  const lesson = await prisma.courseLesson.create({
    data: { courseId: id, ...parsed.data },
  });

  return json({ lesson }, 201);
}

/** Teacher: remove a lesson from own course. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await ownCourse(auth.session.userId, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const { lessonId } = (await request.json()) as { lessonId?: string };
  if (!lessonId) return error("lessonId is required", 422, "VALIDATION");

  await prisma.courseLesson.deleteMany({ where: { id: lessonId, courseId: id } });
  return json({ success: true });
}
