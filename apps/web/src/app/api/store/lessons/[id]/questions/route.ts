import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { notifyTeacherNewQuestion } from "@/services/engagement-notifications.service";
import { getCurrentUser } from "@/lib/auth/session";
import { z } from "zod";

async function findLesson(id: string) {
  return prisma.courseLesson.findFirst({
    where: { id, course: { status: "APPROVED", deletedAt: null } },
    select: {
      id: true,
      title: true,
      course: { select: { teacher: { select: { userId: true } } } },
    },
  });
}

/** Q&A thread for a course video. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const lesson = await findLesson(id);
  if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");

  const questions = await prisma.courseLessonQuestion.findMany({
    where: { lessonId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { id: true, fullLegalName: true, role: true } },
      answers: {
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, fullLegalName: true, role: true } },
        },
      },
    },
  });

  return json({ questions, myUserId: auth.session.userId });
}

const bodySchema = z.object({ body: z.string().trim().min(1).max(2000) });

/** Ask a question on a course video. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const lesson = await findLesson(id);
  if (!lesson) return error("Lesson not found", 404, "NOT_FOUND");

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const question = await prisma.courseLessonQuestion.create({
    data: { lessonId: id, userId: auth.session.userId, body: parsed.data.body },
    include: {
      user: { select: { id: true, fullLegalName: true, role: true } },
      answers: {
        include: {
          user: { select: { id: true, fullLegalName: true, role: true } },
        },
      },
    },
  });

  const asker = await getCurrentUser();
  const teacherUserId = lesson.course.teacher.userId;
  if (teacherUserId !== auth.session.userId) {
    await notifyTeacherNewQuestion({
      teacherUserId,
      lessonTitle: lesson.title,
      studentName: asker?.fullLegalName ?? "A student",
      question: parsed.data.body,
    });
  }

  return json({ question }, 201);
}
