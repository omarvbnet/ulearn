import { prisma } from "@/lib/prisma";

export class CourseSectionService {
  static async list(courseId: string) {
    return prisma.courseSection.findMany({
      where: { courseId, deletedAt: null },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        title: true,
        sortOrder: true,
        createdAt: true,
        _count: { select: { lessons: { where: { deletedAt: null } } } },
      },
    });
  }

  static async create(courseId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return { success: false as const, error: "TITLE_REQUIRED" };

    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true, usesSections: true },
    });
    if (!course) return { success: false as const, error: "NOT_FOUND" };
    if (!course.usesSections) {
      return { success: false as const, error: "SECTIONS_DISABLED" };
    }

    const maxSort = await prisma.courseSection.aggregate({
      where: { courseId, deletedAt: null },
      _max: { sortOrder: true },
    });

    const section = await prisma.courseSection.create({
      data: {
        courseId,
        title: trimmed.slice(0, 120),
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });
    return { success: true as const, section };
  }

  static async update(courseId: string, sectionId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return { success: false as const, error: "TITLE_REQUIRED" };

    const existing = await prisma.courseSection.findFirst({
      where: { id: sectionId, courseId, deletedAt: null },
    });
    if (!existing) return { success: false as const, error: "NOT_FOUND" };

    const section = await prisma.courseSection.update({
      where: { id: sectionId },
      data: { title: trimmed.slice(0, 120) },
    });
    return { success: true as const, section };
  }

  static async remove(courseId: string, sectionId: string) {
    const existing = await prisma.courseSection.findFirst({
      where: { id: sectionId, courseId, deletedAt: null },
      include: { _count: { select: { lessons: { where: { deletedAt: null } } } } },
    });
    if (!existing) return { success: false as const, error: "NOT_FOUND" };
    if (existing._count.lessons > 0) {
      return { success: false as const, error: "SECTION_NOT_EMPTY" };
    }

    await prisma.courseSection.update({
      where: { id: sectionId },
      data: { deletedAt: new Date() },
    });
    return { success: true as const };
  }

  static async reorder(courseId: string, sectionIds: string[]) {
    const existing = await prisma.courseSection.findMany({
      where: { courseId, deletedAt: null },
      select: { id: true },
    });
    const allowed = new Set(existing.map((s) => s.id));
    if (sectionIds.length !== allowed.size || sectionIds.some((id) => !allowed.has(id))) {
      return { success: false as const, error: "INVALID_SECTIONS" };
    }

    await prisma.$transaction(
      sectionIds.map((id, index) =>
        prisma.courseSection.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );
    return { success: true as const };
  }
}
