import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export class ProfessorQuestionBankService {
  static async list(
    instructorId: string,
    params?: {
      q?: string;
      subject?: string;
      chapter?: string;
      difficulty?: string;
      questionType?: string;
      courseId?: string;
      take?: number;
    }
  ) {
    return prisma.professorQuestionBankItem.findMany({
      where: {
        instructorId,
        ...(params?.subject ? { subject: params.subject } : {}),
        ...(params?.chapter ? { chapter: params.chapter } : {}),
        ...(params?.difficulty ? { difficulty: params.difficulty } : {}),
        ...(params?.questionType ? { questionType: params.questionType } : {}),
        ...(params?.courseId ? { courseId: params.courseId } : {}),
        ...(params?.q
          ? { text: { contains: params.q, mode: "insensitive" } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: params?.take ?? 200,
    });
  }

  static async create(
    instructorId: string,
    data: {
      subject?: string;
      chapter?: string;
      lesson?: string;
      topic?: string;
      difficulty?: string;
      bloom?: string;
      questionType: string;
      language?: string;
      text: string;
      options?: Prisma.InputJsonValue;
      correctKey?: string;
      answerKey?: string;
      marks?: number;
      timeEstimateSec?: number;
      courseId?: string;
      documentId?: string;
      examVersion?: string;
    }
  ) {
    return prisma.professorQuestionBankItem.create({
      data: { instructorId, ...data },
    });
  }

  static async remove(instructorId: string, id: string) {
    const item = await prisma.professorQuestionBankItem.findFirst({
      where: { id, instructorId },
    });
    if (!item) throw new Error("Not found");
    await prisma.professorQuestionBankItem.delete({ where: { id } });
    return { ok: true };
  }

  static async exportJson(instructorId: string, ids?: string[]) {
    const items = await prisma.professorQuestionBankItem.findMany({
      where: {
        instructorId,
        ...(ids?.length ? { id: { in: ids } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return items;
  }
}
