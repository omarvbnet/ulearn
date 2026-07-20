import { prisma } from "@/lib/prisma";
import { withCache, CacheTTL } from "@/lib/prisma-cache";
import { LoggingService } from "@/services/logging.service";
import type { Prisma } from "@prisma/client";

export class CourseService {
  static async listStages(countryId: string) {
    return prisma.educationalStage.findMany(
      withCache(
        {
          where: { countryId, deletedAt: null, isActive: true },
          orderBy: { sortOrder: "asc" as const },
          include: {
            subjects: {
              where: { deletedAt: null, isActive: true },
              orderBy: { sortOrder: "asc" as const },
            },
          },
        },
        CacheTTL.reference
      )
    );
  }

  static async listSubjects(countryId: string, stageId?: string) {
    return prisma.subject.findMany({
      where: {
        countryId,
        deletedAt: null,
        isActive: true,
        ...(stageId ? { stageId } : {}),
      },
      orderBy: { sortOrder: "asc" },
      include: {
        chapters: {
          where: { deletedAt: null },
          orderBy: { sortOrder: "asc" },
          include: {
            lessons: {
              where: { deletedAt: null },
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                nameEn: true,
                nameAr: true,
                nameKu: true,
                nameTr: true,
                isFree: true,
                durationSec: true,
                sortOrder: true,
              },
            },
          },
        },
      },
    });
  }

  static async getLesson(lessonId: string, userId?: string) {
    const lesson = await prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: {
        contents: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
        chapter: {
          include: {
            subject: { include: { country: true } },
          },
        },
        quizzes: { where: { deletedAt: null, isActive: true } },
        questions: {
          where: { deletedAt: null },
          include: {
            student: { select: { id: true, fullLegalName: true } },
            answers: {
              include: { teacher: { select: { id: true, fullLegalName: true } } },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!lesson) return null;

    let progress = null;
    let hasAccess = lesson.isFree;

    if (userId) {
      progress = await prisma.videoProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId } },
      });

      if (!hasAccess) {
        hasAccess = await this.userHasSubjectAccess(
          userId,
          lesson.chapter.subjectId,
          lesson.chapter.subject.stageId
        );
      }
    }

    return { lesson, progress, hasAccess };
  }

  static async userHasSubjectAccess(
    userId: string,
    subjectId: string,
    stageId: string | null
  ): Promise<boolean> {
    const now = new Date();
    const active = await prisma.subscription.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        package: {
          OR: [
            { subjectId },
            ...(stageId ? [{ stageId, type: "FULL_STAGE" as const }] : []),
          ],
        },
      },
    });
    return !!active;
  }

  static async createStage(
    data: Prisma.EducationalStageCreateInput,
    actorId: string
  ) {
    const stage = await prisma.educationalStage.create({ data });
    await LoggingService.log({
      actorId,
      action: "CREATE_STAGE",
      entityType: "EducationalStage",
      entityId: stage.id,
      newValue: data as Prisma.InputJsonValue,
    });
    return stage;
  }

  static async createSubject(data: Prisma.SubjectCreateInput, actorId: string) {
    const subject = await prisma.subject.create({ data });
    await LoggingService.log({
      actorId,
      action: "CREATE_SUBJECT",
      entityType: "Subject",
      entityId: subject.id,
      newValue: { nameEn: subject.nameEn },
    });
    return subject;
  }

  static async createChapter(data: Prisma.ChapterCreateInput, actorId: string) {
    const chapter = await prisma.chapter.create({ data });
    await LoggingService.log({
      actorId,
      action: "CREATE_CHAPTER",
      entityType: "Chapter",
      entityId: chapter.id,
    });
    return chapter;
  }

  static async createLesson(data: Prisma.LessonCreateInput, actorId: string) {
    const lesson = await prisma.lesson.create({ data });
    await LoggingService.log({
      actorId,
      action: "CREATE_LESSON",
      entityType: "Lesson",
      entityId: lesson.id,
      newValue: { isFree: lesson.isFree },
    });
    return lesson;
  }

  static async addContent(
    lessonId: string,
    content: {
      type: "VIDEO" | "PDF" | "ATTACHMENT";
      fileKey: string;
      fileUrl?: string;
      fileSize?: number;
      mimeType?: string;
      durationSec?: number;
      titleEn?: string;
      titleAr?: string;
      titleKu?: string;
      titleTr?: string;
      hasSubtitles?: boolean;
      subtitleKeys?: Prisma.InputJsonValue;
    },
    actorId: string
  ) {
    const item = await prisma.lessonContent.create({
      data: { lessonId, ...content },
    });

    if (content.type === "VIDEO" && content.durationSec) {
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { durationSec: { increment: content.durationSec } },
      });
    }

    await LoggingService.log({
      actorId,
      action: "ADD_CONTENT",
      entityType: "LessonContent",
      entityId: item.id,
      newValue: { lessonId, type: content.type },
    });

    const { enqueueLessonContentIngest } = await import("@/services/ai/ingest-hooks");
    enqueueLessonContentIngest(item);

    return item;
  }

  static async softDelete(entity: "stage" | "subject" | "chapter" | "lesson", id: string, actorId: string) {
    const now = new Date();
    const map = {
      stage: () => prisma.educationalStage.update({ where: { id }, data: { deletedAt: now } }),
      subject: () => prisma.subject.update({ where: { id }, data: { deletedAt: now } }),
      chapter: () => prisma.chapter.update({ where: { id }, data: { deletedAt: now } }),
      lesson: () => prisma.lesson.update({ where: { id }, data: { deletedAt: now } }),
    };

    const result = await map[entity]();
    await LoggingService.log({
      actorId,
      action: "SOFT_DELETE",
      entityType: entity,
      entityId: id,
    });
    return result;
  }
}
