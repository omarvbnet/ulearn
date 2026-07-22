import { prisma } from "@/lib/prisma";

export const MAX_TEACHER_SPECIALTIES = 3;
export const MAX_TEACHER_INSIGHTS = 5;

const specialtyWhere = (countryId?: string | null) => ({
  deletedAt: null,
  isActive: true,
  isCertificateProgram: false,
  stageId: null,
  ...(countryId ? { countryId } : {}),
});

const insightWhere = (countryId?: string | null) => ({
  deletedAt: null,
  isActive: true,
  stage: {
    isCertificateTrack: true,
    deletedAt: null,
    isActive: true,
    ...(countryId ? { countryId } : {}),
  },
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

  /** Same insight catalog used by certificate users. */
  static async listAvailableInsights(countryId?: string | null) {
    return prisma.subject.findMany({
      where: insightWhere(countryId),
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        nameKu: true,
        nameTr: true,
        stageId: true,
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
                stageId: true,
              },
            },
          },
        },
      },
    });
    if (!profile) return null;

    const isCert = profile.teachingTrack === "CERTIFICATE";

    const [available, stages] = await Promise.all([
      isCert
        ? this.listAvailableInsights(profile.countryId)
        : this.listAvailableSpecialties(profile.countryId),
      prisma.educationalStage.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          isCertificateTrack: isCert,
          ...(profile.countryId ? { countryId: profile.countryId } : {}),
        },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          nameKu: true,
          nameTr: true,
          isCertificateTrack: true,
        },
      }),
    ]);

    return {
      profile,
      teachingTrack: profile.teachingTrack,
      specialties: profile.subjects.map((s) => s.subject),
      insights: isCert ? profile.subjects.map((s) => s.subject) : [],
      available,
      stages,
    };
  }

  static async updateSpecialties(teacherId: string, subjectIds: string[]) {
    const teacher = await prisma.teacherProfile.findFirst({
      where: { id: teacherId, deletedAt: null },
    });
    if (!teacher) return { success: false as const, error: "NOT_FOUND" as const };

    const isCert = teacher.teachingTrack === "CERTIFICATE";
    const unique = [...new Set(subjectIds)];
    const max = isCert ? MAX_TEACHER_INSIGHTS : MAX_TEACHER_SPECIALTIES;
    const min = 1;
    if (unique.length < min || unique.length > max) {
      return { success: false as const, error: "INVALID_SPECIALTY_COUNT" as const };
    }

    const subjects = await prisma.subject.findMany({
      where: isCert
        ? { id: { in: unique }, ...insightWhere(teacher.countryId) }
        : { id: { in: unique }, ...specialtyWhere(teacher.countryId) },
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
