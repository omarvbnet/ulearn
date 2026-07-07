import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await request.json();
  const { question, attachmentKey, attachmentUrl } = body as {
    question?: string;
    attachmentKey?: string;
    attachmentUrl?: string;
  };

  if (!question?.trim()) {
    return error("Question body is required", 422, "VALIDATION");
  }

  const created = await prisma.lessonQuestion.create({
    data: {
      lessonId: id,
      studentId: auth.session.userId,
      body: question.trim(),
      attachmentKey,
      attachmentUrl,
    },
    include: {
      student: { select: { id: true, fullLegalName: true } },
      answers: true,
    },
  });

  return json({ question: created }, 201);
}
