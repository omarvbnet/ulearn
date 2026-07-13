import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { notifyStudentAnswer } from "@/services/engagement-notifications.service";
import { getCurrentUser } from "@/lib/auth/session";
import { z } from "zod";

const bodySchema = z.object({ body: z.string().trim().min(1).max(2000) });

/** Answer a question on a course video. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const question = await prisma.courseLessonQuestion.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      lesson: {
        select: {
          id: true,
          title: true,
          courseId: true,
          course: { select: { teacher: { select: { userId: true } } } },
        },
      },
    },
  });
  if (!question) return error("Question not found", 404, "NOT_FOUND");

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const answer = await prisma.courseLessonAnswer.create({
    data: { questionId: id, userId: auth.session.userId, body: parsed.data.body },
    include: {
      user: { select: { id: true, fullLegalName: true, role: true } },
    },
  });

  if (question.userId !== auth.session.userId) {
    const answerer = await getCurrentUser();
    await notifyStudentAnswer({
      studentUserId: question.userId,
      lessonTitle: question.lesson.title,
      answererName: answerer?.fullLegalName ?? "Someone",
      courseId: question.lesson.courseId,
      lessonId: question.lesson.id,
    });
  }

  return json({ answer }, 201);
}
