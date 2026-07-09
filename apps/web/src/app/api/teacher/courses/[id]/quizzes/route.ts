import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { QuizService } from "@/services/quiz.service";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { z } from "zod";

async function ownCourse(userId: string, courseId: string) {
  return prisma.course.findFirst({
    where: { id: courseId, deletedAt: null, teacher: { userId, deletedAt: null } },
    select: { id: true, status: true },
  });
}

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

const createSchema = z.object({
  titleEn: z.string().min(2),
  titleAr: z.string().optional(),
  titleKu: z.string().optional(),
  titleTr: z.string().optional(),
  afterLessonId: z.string().optional(),
  timeLimitSec: z.number().int().positive().optional(),
  maxAttempts: z.number().int().positive().optional(),
  passPercentage: z.number().min(0).max(100).optional(),
  questions: z.array(questionSchema).min(1),
});

/** Teacher: list quizzes for a store course. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await ownCourse(auth.session.userId, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const quizzes = await prisma.quiz.findMany({
    where: { courseId: id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { questions: true, attempts: true } } },
  });

  return json({ quizzes });
}

/** Teacher: add a quiz to a store course (minimum 2 required before admin approval). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await ownCourse(auth.session.userId, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { questions, afterLessonId, ...meta } = parsed.data;

  if (afterLessonId) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: afterLessonId, courseId: id },
    });
    if (!lesson) return error("afterLessonId is not in this course", 422, "VALIDATION");
  }

  const quiz = await QuizService.createQuiz({
    type: "COURSE",
    course: { connect: { id } },
    ...(afterLessonId ? { afterLesson: { connect: { id: afterLessonId } } } : {}),
    titleEn: meta.titleEn,
    titleAr: meta.titleAr || meta.titleEn,
    titleKu: meta.titleKu || meta.titleEn,
    titleTr: meta.titleTr || meta.titleEn,
    timeLimitSec: meta.timeLimitSec ?? null,
    maxAttempts: meta.maxAttempts ?? 3,
    passPercentage: meta.passPercentage ?? 50,
    questions: questions.map((q) => ({
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

  if (course.status === "APPROVED") {
    await TeacherCourseService.markCoursePendingReview(id);
  }

  return json({ quiz }, 201);
}

/** Teacher: remove a course quiz. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const course = await ownCourse(auth.session.userId, id);
  if (!course) return error("Course not found", 404, "NOT_FOUND");

  const { quizId } = (await request.json()) as { quizId?: string };
  if (!quizId) return error("quizId required", 422, "VALIDATION");

  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, courseId: id, deletedAt: null },
  });
  if (!quiz) return error("Quiz not found", 404, "NOT_FOUND");

  await prisma.quiz.update({
    where: { id: quizId },
    data: { deletedAt: new Date(), isActive: false },
  });

  if (course.status === "APPROVED") {
    await TeacherCourseService.markCoursePendingReview(id);
  }

  return json({ success: true });
}
