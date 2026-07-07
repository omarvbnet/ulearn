import { error, json, requireAuth } from "@/lib/api";
import { QuizService } from "@/services/quiz.service";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await QuizService.getQuizForUser(id, auth.session.userId);

  if (!result.success) {
    return error(
      result.error === "MAX_ATTEMPTS" ? "Maximum attempts reached" : "Quiz not found",
      result.error === "MAX_ATTEMPTS" ? 403 : 404,
      result.error
    );
  }

  return json({ quiz: result.quiz });
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await request.json();
  const { answers, timeSpentSec } = body as {
    answers?: Record<string, string>;
    timeSpentSec?: number;
  };

  if (!answers || typeof answers !== "object") {
    return error("answers object is required", 422, "VALIDATION");
  }

  const result = await QuizService.submitAttempt({
    quizId: id,
    userId: auth.session.userId,
    answers,
    timeSpentSec,
  });

  if (!result.success) {
    return error(
      result.error === "MAX_ATTEMPTS" ? "Maximum attempts reached" : "Quiz not found",
      result.error === "MAX_ATTEMPTS" ? 403 : 404,
      result.error
    );
  }

  return json({ attempt: result.attempt });
}
