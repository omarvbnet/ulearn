import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
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
  pdfTitle: z.string().optional(),
  pdfFileKey: z.string().optional(),
  pdfFileUrl: z.string().optional(),
  pdfMimeType: z.string().optional(),
  pdfFileSize: z.number().int().positive().optional(),
  videoAssetId: z.string().optional(),
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
    data: {
      courseId: id,
      title: parsed.data.title,
      fileKey: parsed.data.fileKey,
      fileUrl: parsed.data.fileUrl,
      thumbnailKey: parsed.data.thumbnailKey,
      thumbnailUrl: parsed.data.thumbnailUrl,
      durationSec: parsed.data.durationSec,
      sortOrder: parsed.data.sortOrder,
      isFreePreview: parsed.data.isFreePreview ?? false,
      videoAssetId: parsed.data.videoAssetId,
    },
  });

  if (parsed.data.videoAssetId) {
    await prisma.videoAsset.update({
      where: { id: parsed.data.videoAssetId },
      data: { courseLessonId: lesson.id, courseId: id },
    });
  }

  if (parsed.data.pdfFileKey || parsed.data.pdfFileUrl) {
    await TeacherCourseService.attachLessonPdf(id, lesson.id, {
      title: parsed.data.pdfTitle?.trim() || `${parsed.data.title} — PDF`,
      fileKey: parsed.data.pdfFileKey,
      fileUrl: parsed.data.pdfFileUrl,
      mimeType: parsed.data.pdfMimeType,
      fileSize: parsed.data.pdfFileSize,
    });
  }

  if (course.status === "APPROVED") {
    await TeacherCourseService.markCoursePendingReview(id);
  }

  if (!course.thumbnail && parsed.data.thumbnailUrl) {
    await prisma.course.update({
      where: { id },
      data: { thumbnail: parsed.data.thumbnailUrl },
    });
  }

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
  if (course.status === "APPROVED") {
    await TeacherCourseService.markCoursePendingReview(id);
  }
  return json({ success: true });
}
