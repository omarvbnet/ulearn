import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { isWhiteboardLessonsEnabled } from "@/lib/whiteboard-feature";
import {
  isAdminRole,
  TEACHER_COURSE_ROLES,
} from "@/lib/teacher-course-access";
import { normalizeEditDiff } from "@/lib/whiteboard/edit-diff";
import { z } from "zod";

const editDiffSchema = z
  .object({
    ranges: z
      .array(
        z.object({
          id: z.string(),
          startMs: z.number(),
          endMs: z.number(),
          kind: z.enum(["redraw", "trim", "audio", "splice"]).optional(),
          removedMs: z.number().optional(),
          label: z.string().optional(),
        })
      )
      .default([]),
    previousDurationMs: z.number().optional(),
    newDurationMs: z.number().optional(),
  })
  .optional();

const schema = z.object({
  title: z.string().min(1).optional(),
  lessonType: z.enum(["VIDEO", "WHITEBOARD"]).optional(),
  fileKey: z.string().optional(),
  fileUrl: z.string().optional(),
  videoAssetId: z.string().optional(),
  whiteboardAssetId: z.string().optional(),
  thumbnailKey: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().int().optional(),
  isFreePreview: z.boolean().optional(),
  isInterview: z.boolean().optional(),
  freePreviewSec: z.number().int().min(0).max(3600).nullable().optional(),
  sortOrder: z.number().int().optional(),
  pdfTitle: z.string().optional(),
  pdfFileKey: z.string().optional(),
  pdfFileUrl: z.string().optional(),
  pdfMimeType: z.string().optional(),
  pdfFileSize: z.number().int().positive().optional(),
  removePdf: z.boolean().optional(),
  sectionId: z.string().min(1).nullable().optional(),
  editDiff: editDiffSchema,
});

/** Teacher: update a lesson. Live courses queue media changes for admin review. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;
  const isAdmin = isAdminRole(auth.session.role);

  const { id: courseId, lessonId } = await params;
  let teacherId: string | null = null;
  if (!isAdmin) {
    const teacher = await prisma.teacherProfile.findFirst({
      where: { userId: auth.session.userId, deletedAt: null },
    });
    if (!teacher) return error("Teacher profile not found", 404);
    teacherId = teacher.id;
  }

  const lesson = await prisma.courseLesson.findFirst({
    where: {
      id: lessonId,
      courseId,
      course: isAdmin
        ? { deletedAt: null }
        : { teacherId: teacherId!, deletedAt: null },
    },
    include: { course: { select: { status: true } } },
  });
  if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const data = parsed.data;
  if (data.sectionId) {
    const section = await prisma.courseSection.findFirst({
      where: { id: data.sectionId, courseId, deletedAt: null },
      select: { id: true },
    });
    if (!section) return error("Section not found", 404, "SECTION_NOT_FOUND");
  }
  if (
    (data.lessonType === "WHITEBOARD" || data.whiteboardAssetId) &&
    !(await isWhiteboardLessonsEnabled())
  ) {
    return error("Whiteboard lessons are disabled by admin", 403, "FEATURE_DISABLED");
  }
  const hasMediaChange = Boolean(
    data.fileKey ||
      data.fileUrl ||
      data.thumbnailUrl ||
      data.videoAssetId ||
      data.whiteboardAssetId
  );
  const { pdfTitle, pdfFileKey, pdfFileUrl, pdfMimeType, pdfFileSize, removePdf, editDiff, ...lessonPatch } =
    data;
  const normalizedEditDiff = normalizeEditDiff(editDiff ?? null);

  if (lessonPatch.isInterview) {
    lessonPatch.isFreePreview = true;
    lessonPatch.sortOrder = 0;
    await prisma.courseLesson.updateMany({
      where: { courseId, isInterview: true, deletedAt: null, id: { not: lessonId } },
      data: { isInterview: false },
    });
  } else if (lessonPatch.isFreePreview === true && !lesson.isInterview) {
    // First free preview becomes the interview when none exists yet.
    const hasInterview = await prisma.courseLesson.count({
      where: { courseId, isInterview: true, deletedAt: null },
    });
    if (hasInterview === 0) {
      lessonPatch.isInterview = true;
      lessonPatch.sortOrder = 0;
    }
  }

  // Interview lessons must remain free previews.
  if (lesson.isInterview && lessonPatch.isFreePreview === false) {
    return error(
      "The interview video must stay free",
      400,
      "INTERVIEW_MUST_BE_FREE"
    );
  }

  const becomingPaid =
    lessonPatch.isFreePreview === false && lesson.isFreePreview === true;
  // Teachers must keep 2 free previews. Admins can change freely.
  if (becomingPaid && !isAdmin) {
    const remainingFree = await prisma.courseLesson.count({
      where: { courseId, isFreePreview: true, deletedAt: null, id: { not: lessonId } },
    });
    if (remainingFree < 2) {
      return error(
        "A course must keep at least 2 free preview videos",
        400,
        "MIN_FREE_PREVIEWS"
      );
    }
  }

  const willBeFree =
    lessonPatch.isFreePreview === true ||
    (lessonPatch.isFreePreview === undefined &&
      (lesson.isFreePreview || lessonPatch.isInterview === true));

  if (!isAdmin && willBeFree && lessonPatch.isFreePreview !== false) {
    const previews = await prisma.courseLesson.count({
      where: { courseId, isFreePreview: true, deletedAt: null, id: { not: lessonId } },
    });
    if (previews >= 2 && !lesson.isFreePreview) {
      return error("A course can have at most 2 free preview lessons", 400, "FREE_PREVIEW_LIMIT");
    }
  }

  // Full free preview and timed free preview are mutually exclusive.
  if (lessonPatch.isFreePreview === true || lessonPatch.isInterview === true) {
    lessonPatch.freePreviewSec = null;
  } else if (lessonPatch.freePreviewSec !== undefined) {
    const sec = lessonPatch.freePreviewSec;
    lessonPatch.freePreviewSec = sec != null && sec > 0 ? sec : null;
  }

  if (!isAdmin && lesson.course.status === "APPROVED" && hasMediaChange) {
    const changeTags: string[] = [];
    if (data.title != null && data.title !== lesson.title) changeTags.push("title");
    if (data.fileKey || data.fileUrl || data.videoAssetId) changeTags.push("video");
    if (data.whiteboardAssetId) changeTags.push("whiteboard");
    if (data.thumbnailKey || data.thumbnailUrl) changeTags.push("thumbnail");
    if (data.durationSec != null && data.durationSec !== lesson.durationSec) {
      changeTags.push("duration");
    }

    const pending = await prisma.courseLessonUpdateRequest.create({
      data: {
        lessonId,
        teacherId: teacherId!,
        title: data.title,
        fileKey: data.fileKey,
        fileUrl: data.fileUrl,
        thumbnailKey: data.thumbnailKey,
        thumbnailUrl: data.thumbnailUrl,
        durationSec: data.durationSec,
        whiteboardAssetId: data.whiteboardAssetId,
        previousWhiteboardAssetId: lesson.whiteboardAssetId,
        previousTitle: lesson.title,
        previousFileKey: lesson.fileKey,
        previousFileUrl: lesson.fileUrl,
        previousThumbnailKey: lesson.thumbnailKey,
        previousThumbnailUrl: lesson.thumbnailUrl,
        previousDurationSec: lesson.durationSec,
        changeSummary: changeTags.join(",") || (data.whiteboardAssetId ? "whiteboard" : "video"),
        editDiffJson: normalizedEditDiff ?? undefined,
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

  if (data.whiteboardAssetId) {
    await prisma.whiteboardAsset.update({
      where: { id: data.whiteboardAssetId },
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
    !isAdmin &&
    lesson.course.status === "APPROVED" &&
    (Object.keys(lessonPatch).length > 0 || pdfFileKey || pdfFileUrl || removePdf)
  ) {
    await TeacherCourseService.markCoursePendingReview(courseId);
  }

  return json({ lesson: updated, pendingReview: false });
}
