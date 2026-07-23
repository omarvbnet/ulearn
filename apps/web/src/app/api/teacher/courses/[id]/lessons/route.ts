import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { isWhiteboardLessonsEnabled } from "@/lib/whiteboard-feature";
import { TeacherCourseService } from "@/services/teacher-course.service";
import {
  findEditableCourse,
  isAdminRole,
  TEACHER_COURSE_ROLES,
} from "@/lib/teacher-course-access";
import { z } from "zod";

const lessonSchema = z.object({
  title: z.string().min(1),
  lessonType: z.enum(["VIDEO", "WHITEBOARD"]).optional().default("VIDEO"),
  fileKey: z.string().optional(),
  fileUrl: z.string().optional(),
  thumbnailKey: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().int().optional(),
  sortOrder: z.number().int().optional(),
  isFreePreview: z.boolean().optional(),
  isInterview: z.boolean().optional(),
  freePreviewSec: z.number().int().min(0).max(3600).nullable().optional(),
  pdfTitle: z.string().optional(),
  pdfFileKey: z.string().optional(),
  pdfFileUrl: z.string().optional(),
  pdfMimeType: z.string().optional(),
  pdfFileSize: z.number().int().positive().optional(),
  videoAssetId: z.string().optional(),
  whiteboardAssetId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.lessonType === "WHITEBOARD") {
    if (!data.whiteboardAssetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "whiteboardAssetId is required for WHITEBOARD lessons",
        path: ["whiteboardAssetId"],
      });
    }
  }
});

/** Teacher: add a lesson to own course. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;
  const isAdmin = isAdminRole(auth.session.role);

  const { id } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const parsed = lessonSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const isInterview = parsed.data.isInterview === true;
  const isFreePreview = isInterview || parsed.data.isFreePreview === true;
  const freePreviewSec =
    isFreePreview
      ? null
      : parsed.data.freePreviewSec != null && parsed.data.freePreviewSec > 0
        ? parsed.data.freePreviewSec
        : null;

  // Teachers: at most 2 full free preview videos. Admins can set freely.
  if (isFreePreview && !isAdmin) {
    const previews = await prisma.courseLesson.count({
      where: { courseId: id, isFreePreview: true, deletedAt: null },
    });
    if (previews >= 2) {
      return error("A course can have at most 2 free preview lessons", 400, "FREE_PREVIEW_LIMIT");
    }
  }

  if (isInterview) {
    await prisma.courseLesson.updateMany({
      where: { courseId: id, isInterview: true, deletedAt: null },
      data: { isInterview: false },
    });
  }

  const lessonType = parsed.data.lessonType ?? "VIDEO";
  if (lessonType === "WHITEBOARD" && !(await isWhiteboardLessonsEnabled())) {
    return error("Whiteboard lessons are disabled by admin", 403, "FEATURE_DISABLED");
  }
  // Interview is video-only.
  if (isInterview && lessonType === "WHITEBOARD") {
    return error("Interview lessons must be VIDEO", 400, "INVALID_LESSON_TYPE");
  }

  const maxSort = await prisma.courseLesson.aggregate({
    where: { courseId: id, deletedAt: null },
    _max: { sortOrder: true },
  });

  const lesson = await prisma.courseLesson.create({
    data: {
      courseId: id,
      title: parsed.data.title,
      lessonType,
      fileKey: parsed.data.fileKey,
      fileUrl: parsed.data.fileUrl,
      thumbnailKey: parsed.data.thumbnailKey,
      thumbnailUrl: parsed.data.thumbnailUrl,
      durationSec: parsed.data.durationSec,
      sortOrder: isInterview ? 0 : (parsed.data.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1),
      isFreePreview,
      freePreviewSec,
      isInterview,
      videoAssetId: lessonType === "VIDEO" ? parsed.data.videoAssetId : undefined,
      whiteboardAssetId:
        lessonType === "WHITEBOARD" ? parsed.data.whiteboardAssetId : undefined,
    },
  });

  if (isInterview) {
    // Shift other lessons down so interview stays first.
    await prisma.courseLesson.updateMany({
      where: { courseId: id, id: { not: lesson.id }, deletedAt: null },
      data: { sortOrder: { increment: 1 } },
    });
  }

  if (parsed.data.videoAssetId && lessonType === "VIDEO") {
    await prisma.videoAsset.update({
      where: { id: parsed.data.videoAssetId },
      data: { courseLessonId: lesson.id, courseId: id },
    });
  }

  if (parsed.data.whiteboardAssetId && lessonType === "WHITEBOARD") {
    await prisma.whiteboardAsset.update({
      where: { id: parsed.data.whiteboardAssetId },
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

  if (course.status === "APPROVED" && !isAdmin) {
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
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;
  const isAdmin = isAdminRole(auth.session.role);

  const { id } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const { lessonId } = (await request.json()) as { lessonId?: string };
  if (!lessonId) return error("lessonId is required", 422, "VALIDATION");

  const lesson = await prisma.courseLesson.findFirst({
    where: { id: lessonId, courseId: id, deletedAt: null },
    select: { id: true, isFreePreview: true, isInterview: true },
  });
  if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");

  // Teachers must keep 2 free previews. Admins can remove freely.
  if (lesson.isFreePreview && !isAdmin) {
    const remainingFree = await prisma.courseLesson.count({
      where: { courseId: id, isFreePreview: true, deletedAt: null, id: { not: lessonId } },
    });
    if (remainingFree < 2) {
      return error(
        "A course must keep at least 2 free preview videos",
        400,
        "MIN_FREE_PREVIEWS"
      );
    }
  }

  await prisma.courseLesson.updateMany({
    where: { id: lessonId, courseId: id },
    data: { deletedAt: new Date(), isHidden: true },
  });
  if (course.status === "APPROVED" && !isAdmin) {
    await TeacherCourseService.markCoursePendingReview(id);
  }
  return json({ success: true });
}
