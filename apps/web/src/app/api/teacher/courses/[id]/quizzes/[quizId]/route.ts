import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { QuizService } from "@/services/quiz.service";
import { TeacherCourseService } from "@/services/teacher-course.service";
import {
  findEditableCourse,
  isAdminRole,
  TEACHER_COURSE_ROLES,
} from "@/lib/teacher-course-access";
import { z } from "zod";

const questionSchema = z.object({
  textEn: z.string().min(1),
  textAr: z.string().optional(),
  textKu: z.string().optional(),
  textTr: z.string().optional(),
  options: z.record(z.string(), z.string()),
  correctKey: z.string().min(1),
  points: z.number().int().positive().optional(),
  timeLimitSec: z.number().int().positive().optional(),
});

const patchSchema = z.object({
  titleEn: z.string().min(2).optional(),
  titleAr: z.string().optional(),
  titleKu: z.string().optional(),
  titleTr: z.string().optional(),
  afterLessonId: z.string().nullable().optional(),
  timeLimitSec: z.number().int().positive().nullable().optional(),
  maxAttempts: z.number().int().positive().optional(),
  passPercentage: z.number().min(0).max(100).optional(),
  questions: z.array(questionSchema).min(1).optional(),
});

/** Teacher or admin: update a course quiz. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; quizId: string }> }
) {
  const auth = await requireAuth([...TEACHER_COURSE_ROLES]);
  if (auth.error) return auth.error;

  const { id: courseId, quizId } = await params;
  const course = await findEditableCourse(auth.session.userId, auth.session.role, courseId, {
    id: true,
    status: true,
  });
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, courseId, deletedAt: null },
  });
  if (!quiz) return error("Quiz not found", 404, "NOT_FOUND");

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { questions, afterLessonId, ...meta } = parsed.data;

  if (afterLessonId) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: afterLessonId, courseId },
    });
    if (!lesson) return error("afterLessonId is not in this course", 422, "VALIDATION");
  }

  const updated = await QuizService.updateCourseQuiz(quizId, {
    ...meta,
    ...(afterLessonId !== undefined ? { afterLessonId: afterLessonId ?? null } : {}),
    questions: questions?.map((q) => ({
      textEn: q.textEn,
      textAr: q.textAr || q.textEn,
      textKu: q.textKu || q.textEn,
      textTr: q.textTr || q.textEn,
      options: q.options,
      correctKey: q.correctKey,
      points: q.points ?? 1,
      timeLimitSec: q.timeLimitSec ?? null,
    })),
  });

  if (course.status === "APPROVED" && !isAdminRole(auth.session.role)) {
    await TeacherCourseService.markCoursePendingReview(courseId);
  }

  return json({ quiz: updated });
}
