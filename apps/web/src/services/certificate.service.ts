import { prisma } from "@/lib/prisma";
import {
  generateCertificateNumber,
  generateVerificationCode,
} from "@/lib/utils";
import { LoggingService } from "@/services/logging.service";

export class CertificateService {
  static async checkEligibility(userId: string, subjectId: string) {
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      include: {
        chapters: {
          where: { deletedAt: null },
          include: { lessons: { where: { deletedAt: null } } },
        },
      },
    });
    if (!subject) return { eligible: false, reason: "SUBJECT_NOT_FOUND" };

    const lessonIds = subject.chapters.flatMap((c) => c.lessons.map((l) => l.id));
    if (lessonIds.length === 0) return { eligible: false, reason: "NO_LESSONS" };

    const completed = await prisma.videoProgress.count({
      where: { userId, lessonId: { in: lessonIds }, isCompleted: true },
    });

    const completionPct = (completed / lessonIds.length) * 100;
    if (completionPct < 100) {
      return { eligible: false, reason: "INCOMPLETE", completionPct };
    }

    // Require passing final quiz if present
    const finalQuiz = await prisma.quiz.findFirst({
      where: { subjectId, type: "SUBJECT_FINAL", deletedAt: null, isActive: true },
    });

    if (finalQuiz) {
      const pass = await prisma.quizAttempt.findFirst({
        where: { quizId: finalQuiz.id, userId, passed: true },
      });
      if (!pass) return { eligible: false, reason: "QUIZ_NOT_PASSED", completionPct };
    }

    return { eligible: true, completionPct: 100, totalHours: subject.totalHours };
  }

  static async generate(userId: string, subjectId: string, actorId?: string) {
    const existing = await prisma.certificate.findUnique({
      where: { userId_subjectId: { userId, subjectId } },
    });
    if (existing) return { success: true as const, certificate: existing };

    const eligibility = await this.checkEligibility(userId, subjectId);
    if (!eligibility.eligible) {
      return { success: false as const, error: eligibility.reason };
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!user || !subject) {
      return { success: false as const, error: "NOT_FOUND" };
    }

    const certificateNumber = generateCertificateNumber();
    const verificationCode = generateVerificationCode();
    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://ulearn.app"}/verify/${verificationCode}`;

    const certificate = await prisma.certificate.create({
      data: {
        userId,
        subjectId,
        certificateNumber,
        verificationCode,
        userName: user.fullLegalName || user.phone,
        courseName: subject.nameEn,
        completionDate: new Date(),
        totalHours: subject.totalHours,
        qrCodeData: verifyUrl,
      },
    });

    await LoggingService.log({
      actorId: actorId ?? userId,
      action: "GENERATE_CERTIFICATE",
      entityType: "Certificate",
      entityId: certificate.id,
      newValue: { certificateNumber, userId, subjectId },
    });

    return { success: true as const, certificate };
  }

  static async verify(verificationCode: string) {
    return prisma.certificate.findUnique({
      where: { verificationCode },
      include: {
        user: { select: { fullLegalName: true } },
        subject: {
          select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true },
        },
      },
    });
  }

  static async getUserCertificates(userId: string) {
    return prisma.certificate.findMany({
      where: { userId },
      include: { subject: true },
      orderBy: { createdAt: "desc" },
    });
  }
}
