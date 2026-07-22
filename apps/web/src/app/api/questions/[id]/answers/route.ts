import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { STAFF_ROLES } from "@/lib/auth/session";
import { NotificationService } from "@/services/notification.service";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireAuth(STAFF_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await request.json();
  const { answer, attachmentKey, attachmentUrl, resolve } = body as {
    answer?: string;
    attachmentKey?: string;
    attachmentUrl?: string;
    resolve?: boolean;
  };

  if (!answer?.trim()) {
    return error("Answer body is required", 422, "VALIDATION");
  }

  const question = await prisma.lessonQuestion.findFirst({
    where: { id, deletedAt: null },
  });
  if (!question) return error("Question not found", 404, "NOT_FOUND");

  const created = await prisma.lessonAnswer.create({
    data: {
      questionId: id,
      teacherId: auth.session.userId,
      body: answer.trim(),
      attachmentKey,
      attachmentUrl,
    },
    include: {
      teacher: { select: { id: true, fullLegalName: true } },
    },
  });

  if (resolve) {
    await prisma.lessonQuestion.update({
      where: { id },
      data: { isResolved: true },
    });
  }

  await NotificationService.notifyUser(question.studentId, {
    titleEn: "Your question was answered",
    titleAr: "تمت الإجابة على سؤالك",
    titleKu: "وەڵامی پرسیارەکەت درایەوە",
    titleTr: "Sorunuz yanıtlandı",
    bodyEn: "A teacher has replied to your question. Open the lesson to read the answer.",
    bodyAr: "قام المعلم بالرد على سؤالك. افتح الدرس لقراءة الإجابة.",
    bodyKu: "مامۆستایەک وەڵامی پرسیارەکەتی دایەوە. وانەکە بکەرەوە بۆ خوێندنەوەی وەڵامەکە.",
    bodyTr: "Bir öğretmen sorunuzu yanıtladı. Cevabı okumak için dersi açın.",
  }, { lessonId: question.lessonId, questionId: id });

  return json({ answer: created }, 201);
}
