import { error, json, requireAuth } from "@/lib/api";
import { STAFF_ROLES } from "@/lib/auth/session";
import { LoggingService } from "@/services/logging.service";
import { QuizService } from "@/services/quiz.service";

export async function POST(request: Request) {
  const auth = await requireAuth(STAFF_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const {
    type, lessonId, chapterId, subjectId,
    titleEn, titleAr, titleKu, titleTr,
    timeLimitSec, maxAttempts, passPercentage, randomize,
    questions,
  } = body;

  if (!type || !titleEn || !questions?.length) {
    return error("type, titleEn, and at least one question are required", 422, "VALIDATION");
  }

  for (const q of questions) {
    if (!q.textEn || !q.correctKey) {
      return error("Each question needs textEn and correctKey", 422, "VALIDATION");
    }
  }

  const quiz = await QuizService.createQuiz({
    type,
    ...(lessonId ? { lesson: { connect: { id: lessonId } } } : {}),
    ...(chapterId ? { chapter: { connect: { id: chapterId } } } : {}),
    ...(subjectId ? { subject: { connect: { id: subjectId } } } : {}),
    titleEn,
    titleAr: titleAr || titleEn,
    titleKu: titleKu || titleEn,
    titleTr: titleTr || titleEn,
    timeLimitSec: timeLimitSec || null,
    maxAttempts: maxAttempts ?? 3,
    passPercentage: passPercentage ?? 50,
    randomize: randomize ?? true,
    questions: questions.map(
      (q: {
        type?: "MULTIPLE_CHOICE" | "TRUE_FALSE";
        textEn: string;
        textAr?: string;
        textKu?: string;
        textTr?: string;
        options: Record<string, string>;
        correctKey: string;
        points?: number;
      }) => ({
        type: q.type ?? "MULTIPLE_CHOICE",
        textEn: q.textEn,
        textAr: q.textAr || q.textEn,
        textKu: q.textKu || q.textEn,
        textTr: q.textTr || q.textEn,
        options: q.options,
        correctKey: q.correctKey,
        points: q.points ?? 1,
      })
    ),
  });

  await LoggingService.log({
    actorId: auth.session.userId,
    action: "CREATE_QUIZ",
    entityType: "Quiz",
    entityId: quiz.id,
    newValue: { titleEn, questionCount: questions.length },
  });

  return json({ quiz }, 201);
}
