import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(1).optional(),
  fileKey: z.string().optional(),
  fileUrl: z.string().optional(),
  videoAssetId: z.string().optional(),
  thumbnailKey: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().int().optional(),
  isFreePreview: z.boolean().optional(),
  isInterview: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  pdfTitle: z.string().optional(),
  pdfFileKey: z.string().optional(),
  pdfFileUrl: z.string().optional(),
  pdfMimeType: z.string().optional(),
  pdfFileSize: z.number().int().positive().optional(),
  removePdf: z.boolean().optional(),
});

/** Teacher: update a lesson. Live courses queue media changes for admin review. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id: courseId, lessonId } = await params;
  const teacher = await prisma.teacherProfile.findFirst({
    where: { userId: auth.session.userId, deletedAt: null },
  });
  if (!teacher) return error("Teacher profile not found", 404);

  const lesson = await prisma.courseLesson.findFirst({
    where: { id: lessonId, courseId, course: { teacherId: teacher.id, deletedAt: null } },
    include: { course: { select: { status: true } } },
  });
  if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const data = parsed.data;
  const hasMediaChange = Boolean(
    data.fileKey || data.fileUrl || data.thumbnailUrl || data.videoAssetId
  );
  const { pdfTitle, pdfFileKey, pdfFileUrl, pdfMimeType, pdfFileSize, removePdf, ...lessonPatch } =
    data;

  if (lessonPatch.isInterview) {
    lessonPatch.isFreePreview = true;
    lessonPatch.sortOrder = 0;
    await prisma.courseLesson.updateMany({
      where: { courseId, isInterview: true, deletedAt: null, id: { not: lessonId } },
      data: { isInterview: false },
    });
  }

  const willBeFree =
    lessonPatch.isFreePreview === true ||
    (lessonPatch.isFreePreview === undefined &&
      (lesson.isFreePreview || lessonPatch.isInterview === true));

  if (willBeFree && lessonPatch.isFreePreview !== false) {
    const previews = await prisma.courseLesson.count({
      where: { courseId, isFreePreview: true, deletedAt: null, id: { not: lessonId } },
    });
    if (previews >= 2 && !lesson.isFreePreview) {
      return error("A course can have at most 2 free preview lessons", 400, "FREE_PREVIEW_LIMIT");
    }
  }

  if (lesson.course.status === "APPROVED" && hasMediaChange) {
    const pending = await prisma.courseLessonUpdateRequest.create({
      data: {
        lessonId,
        teacherId: teacher.id,
        ...lessonPatch,
        status: "PENDING",
      },
    });
    return json({
      pendingReview: true,
      request: pending,
      message: "Update submitted for admin review.",
    });
  }

  const updated = await prisma.courseLesson.update({
    where: { id: lessonId },
    data: lessonPatch,
  });

  if (data.videoAssetId) {
    await prisma.videoAsset.update({
      where: { id: data.videoAssetId },
      data: { courseLessonId: lessonId, courseId },
    });
  }

  if (removePdf) {
    await prisma.courseMaterial.updateMany({
      where: { courseId, lessonId, deletedAt: null, type: "PDF" },
      data: { deletedAt: new Date() },
    });
  } else if (pdfFileKey || pdfFileUrl) {
    await TeacherCourseService.attachLessonPdf(courseId, lessonId, {
      title: pdfTitle?.trim() || `${updated.title} — PDF`,
      fileKey: pdfFileKey,
      fileUrl: pdfFileUrl,
      mimeType: pdfMimeType,
      fileSize: pdfFileSize,
    });
  }

  if (
    lesson.course.status === "APPROVED" &&
    (Object.keys(lessonPatch).length > 0 || pdfFileKey || pdfFileUrl || removePdf)
  ) {
    await TeacherCourseService.markCoursePendingReview(courseId);
  }

  return json({ lesson: updated, pendingReview: false });
}
