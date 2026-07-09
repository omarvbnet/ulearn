import { prisma } from "@/lib/prisma";

export const MAX_TEACHER_SPECIALTIES = 3;

const specialtyWhere = (countryId?: string | null) => ({
  deletedAt: null,
  isActive: true,
  isCertificateProgram: false,
  stageId: null,
  ...(countryId ? { countryId } : {}),
});

export class TeacherProfileService {
  /** Catalog of specialties teachers can pick (admin-managed Subject rows). */
  static async listAvailableSpecialties(countryId?: string | null) {
    return prisma.subject.findMany({
      where: specialtyWhere(countryId),
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        nameKu: true,
        nameTr: true,
      },
    });
  }

  static async getTeacherContext(userId: string) {
    const profile = await prisma.teacherProfile.findFirst({
      where: { userId, deletedAt: null },
      include: {
        subjects: {
          include: {
            subject: {
              select: {
                id: true,
                nameEn: true,
                nameAr: true,
                nameKu: true,
                nameTr: true,
              },
            },
          },
        },
      },
    });
    if (!profile) return null;

    const [available, stages] = await Promise.all([
      this.listAvailableSpecialties(profile.countryId),
      prisma.educationalStage.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          ...(profile.countryId ? { countryId: profile.countryId } : {}),
        },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          nameKu: true,
          nameTr: true,
        },
      }),
    ]);

    return {
      profile,
      specialties: profile.subjects.map((s) => s.subject),
      available,
      stages,
    };
  }

  static async updateSpecialties(teacherId: string, subjectIds: string[]) {
    const unique = [...new Set(subjectIds)];
    if (unique.length < 1 || unique.length > MAX_TEACHER_SPECIALTIES) {
      return { success: false as const, error: "INVALID_SPECIALTY_COUNT" as const };
    }

    const teacher = await prisma.teacherProfile.findFirst({
      where: { id: teacherId, deletedAt: null },
    });
    if (!teacher) return { success: false as const, error: "NOT_FOUND" as const };

    const subjects = await prisma.subject.findMany({
      where: {
        id: { in: unique },
        ...specialtyWhere(teacher.countryId),
      },
    });
    if (subjects.length !== unique.length) {
      return { success: false as const, error: "INVALID_SUBJECT" as const };
    }

    await prisma.$transaction([
      prisma.teacherSubject.deleteMany({ where: { teacherId } }),
      prisma.teacherSubject.createMany({
        data: unique.map((subjectId) => ({ teacherId, subjectId })),
      }),
      prisma.teacherProfile.update({
        where: { id: teacherId },
        data: { specializations: subjects.map((s) => s.nameEn) },
      }),
    ]);

    return { success: true as const, subjects };
  }
}
