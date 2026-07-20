import { prisma } from "@/lib/prisma";
import { CacheTTL } from "@/lib/prisma-cache";
import { resolvePublicMediaUrl } from "@/lib/r2";
import { LoggingService } from "@/services/logging.service";
import { NotificationService } from "@/services/notification.service";
import { TeacherCourseService } from "@/services/teacher-course.service";

export class CourseGroupService {
  static computeTotal(
    courses: { price: number; currency: string }[]
  ): { totalPrice: number; currency: string } {
    const totalPrice = courses.reduce((s, c) => s + (c.price || 0), 0);
    return {
      totalPrice: Math.round(totalPrice * 100) / 100,
      currency: courses[0]?.currency ?? "IQD",
    };
  }

  static async listAdmin(stageId?: string) {
    const groups = await prisma.courseGroup.findMany({
      where: {
        deletedAt: null,
        ...(stageId ? { stageId } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: {
        stage: {
          select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
        },
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            course: {
              select: {
                id: true,
                titleEn: true,
                titleAr: true,
                price: true,
                currency: true,
                status: true,
                thumbnail: true,
                stageId: true,
              },
            },
          },
        },
        _count: { select: { purchases: true } },
      },
    });

    return groups.map((g) => {
      const courses = g.items.map((i) => i.course);
      const { totalPrice, currency } = this.computeTotal(courses);
      return {
        ...g,
        coverUrl: g.coverUrl,
        courseCount: g.items.length,
        totalPrice,
        currency: g.currency || currency,
      };
    });
  }

  static async getAdmin(id: string) {
    const group = await prisma.courseGroup.findFirst({
      where: { id, deletedAt: null },
      include: {
        stage: {
          select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
        },
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            course: {
              select: {
                id: true,
                titleEn: true,
                titleAr: true,
                titleKu: true,
                titleTr: true,
                price: true,
                currency: true,
                status: true,
                thumbnail: true,
                stageId: true,
              },
            },
          },
        },
      },
    });
    if (!group) return null;
    const courses = group.items.map((i) => i.course);
    const { totalPrice, currency } = this.computeTotal(courses);
    return {
      ...group,
      courseCount: group.items.length,
      totalPrice,
      currency: group.currency || currency,
    };
  }

  static async create(params: {
    titleEn: string;
    titleAr?: string;
    titleKu?: string;
    titleTr?: string;
    description?: string;
    coverKey?: string;
    coverUrl?: string;
    stageId: string;
    countryId?: string;
    currency?: string;
    isActive?: boolean;
    sortOrder?: number;
    courseIds: string[];
    actorId: string;
  }) {
    const stage = await prisma.educationalStage.findFirst({
      where: { id: params.stageId, deletedAt: null },
    });
    if (!stage) return { success: false as const, error: "STAGE_NOT_FOUND" };

    const courses = await prisma.course.findMany({
      where: {
        id: { in: params.courseIds },
        stageId: params.stageId,
        status: "APPROVED",
        deletedAt: null,
      },
      select: { id: true, price: true, currency: true },
    });
    if (courses.length !== params.courseIds.length) {
      return { success: false as const, error: "INVALID_COURSES" };
    }

    const { currency } = this.computeTotal(courses);
    const group = await prisma.courseGroup.create({
      data: {
        titleEn: params.titleEn,
        titleAr: params.titleAr,
        titleKu: params.titleKu,
        titleTr: params.titleTr,
        description: params.description,
        coverKey: params.coverKey,
        coverUrl: params.coverUrl,
        stageId: params.stageId,
        countryId: params.countryId ?? stage.countryId,
        currency: params.currency || currency,
        isActive: params.isActive ?? true,
        sortOrder: params.sortOrder ?? 0,
        items: {
          create: params.courseIds.map((courseId, index) => ({
            courseId,
            sortOrder: index,
          })),
        },
      },
      include: { items: true },
    });

    await LoggingService.log({
      actorId: params.actorId,
      action: "CREATE_COURSE_GROUP",
      entityType: "CourseGroup",
      entityId: group.id,
      newValue: { courseIds: params.courseIds },
    });

    return { success: true as const, group };
  }

  static async update(
    id: string,
    params: {
      titleEn?: string;
      titleAr?: string | null;
      titleKu?: string | null;
      titleTr?: string | null;
      description?: string | null;
      coverKey?: string | null;
      coverUrl?: string | null;
      stageId?: string;
      isActive?: boolean;
      sortOrder?: number;
      courseIds?: string[];
      actorId: string;
    }
  ) {
    const existing = await prisma.courseGroup.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return { success: false as const, error: "NOT_FOUND" };

    const stageId = params.stageId ?? existing.stageId;
    if (params.courseIds) {
      const courses = await prisma.course.findMany({
        where: {
          id: { in: params.courseIds },
          stageId,
          status: "APPROVED",
          deletedAt: null,
        },
        select: { id: true },
      });
      if (courses.length !== params.courseIds.length) {
        return { success: false as const, error: "INVALID_COURSES" };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.courseGroup.update({
        where: { id },
        data: {
          ...(params.titleEn !== undefined ? { titleEn: params.titleEn } : {}),
          ...(params.titleAr !== undefined ? { titleAr: params.titleAr } : {}),
          ...(params.titleKu !== undefined ? { titleKu: params.titleKu } : {}),
          ...(params.titleTr !== undefined ? { titleTr: params.titleTr } : {}),
          ...(params.description !== undefined
            ? { description: params.description }
            : {}),
          ...(params.coverKey !== undefined ? { coverKey: params.coverKey } : {}),
          ...(params.coverUrl !== undefined ? { coverUrl: params.coverUrl } : {}),
          ...(params.stageId !== undefined ? { stageId: params.stageId } : {}),
          ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
          ...(params.sortOrder !== undefined ? { sortOrder: params.sortOrder } : {}),
        },
      });

      if (params.courseIds) {
        await tx.courseGroupItem.deleteMany({ where: { groupId: id } });
        if (params.courseIds.length) {
          await tx.courseGroupItem.createMany({
            data: params.courseIds.map((courseId, index) => ({
              groupId: id,
              courseId,
              sortOrder: index,
            })),
          });
        }
      }
    });

    await LoggingService.log({
      actorId: params.actorId,
      action: "UPDATE_COURSE_GROUP",
      entityType: "CourseGroup",
      entityId: id,
      newValue: { courseIds: params.courseIds },
    });

    return { success: true as const, group: await this.getAdmin(id) };
  }

  static async softDelete(id: string, actorId: string) {
    const existing = await prisma.courseGroup.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return { success: false as const, error: "NOT_FOUND" };
    await prisma.courseGroup.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await LoggingService.log({
      actorId,
      action: "DELETE_COURSE_GROUP",
      entityType: "CourseGroup",
      entityId: id,
    });
    return { success: true as const };
  }

  /** Public / home listing. Optionally scoped to a stage and/or country. */
  static async listForHome(opts?: { stageId?: string; countryId?: string }) {
    const groups = await prisma.courseGroup.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(opts?.stageId ? { stageId: opts.stageId } : {}),
        ...(opts?.countryId
          ? { OR: [{ countryId: null }, { countryId: opts.countryId }] }
          : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            course: {
              select: {
                id: true,
                price: true,
                currency: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        },
      },
      cacheStrategy: CacheTTL.catalog,
    });

    const mapped = await Promise.all(
      groups.map(async (g) => {
        const live = g.items
          .map((i) => i.course)
          .filter((c) => c.status === "APPROVED" && !c.deletedAt);
        const { totalPrice, currency } = this.computeTotal(live);
        const coverUrl =
          (await resolvePublicMediaUrl(g.coverUrl, g.coverKey).catch(() => null)) ??
          g.coverUrl;
        return {
          id: g.id,
          titleEn: g.titleEn,
          titleAr: g.titleAr,
          titleKu: g.titleKu,
          titleTr: g.titleTr,
          description: g.description,
          coverUrl,
          stageId: g.stageId,
          courseCount: live.length,
          totalPrice,
          currency: g.currency || currency,
          sortOrder: g.sortOrder,
        };
      })
    );

    // Hide empty shells (no live courses) from the home rail.
    return mapped.filter((g) => g.courseCount > 0);
  }

  /** @deprecated Prefer listForHome — kept for callers that always pass a stage. */
  static async listForStage(stageId: string) {
    return this.listForHome({ stageId });
  }

  static async getPublic(id: string, userId?: string) {
    const group = await prisma.courseGroup.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: {
        stage: {
          select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
        },
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            course: {
              include: {
                teacher: {
                  select: {
                    id: true,
                    level: true,
                    user: { select: { fullLegalName: true } },
                  },
                },
                stage: {
                  select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
                },
                subject: {
                  select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
                },
                _count: {
                  select: {
                    purchases: { where: { status: "PAID" } },
                    lessons: { where: { deletedAt: null } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!group) return null;

    const courses = group.items
      .map((i) => i.course)
      .filter((c) => c.status === "APPROVED" && !c.deletedAt);

    const { totalPrice, currency } = this.computeTotal(courses);
    const coverUrl =
      (await resolvePublicMediaUrl(group.coverUrl, group.coverKey).catch(() => null)) ??
      group.coverUrl;

    let purchaseStatus: string | null = null;
    let purchased = false;
    if (userId) {
      const gp = await prisma.courseGroupPurchase.findUnique({
        where: { groupId_userId: { groupId: id, userId } },
      });
      purchaseStatus = gp?.status ?? null;
      purchased = gp?.status === "PAID";
    }

    const mappedCourses = await Promise.all(
      courses.map(async (c) => {
        const thumbnail =
          (await resolvePublicMediaUrl(c.thumbnail, null).catch(() => null)) ??
          c.thumbnail;
        let coursePurchased = purchased;
        let coursePurchaseStatus: string | null = purchaseStatus;
        if (userId && !purchased) {
          const cp = await prisma.coursePurchase.findUnique({
            where: { courseId_userId: { courseId: c.id, userId } },
          });
          coursePurchased = cp?.status === "PAID";
          coursePurchaseStatus = cp?.status ?? null;
        }
        return {
          id: c.id,
          titleEn: c.titleEn,
          titleAr: c.titleAr,
          titleKu: c.titleKu,
          titleTr: c.titleTr,
          description: c.description,
          thumbnail,
          price: c.price,
          currency: c.currency,
          teacher: c.teacher,
          stage: c.stage,
          subject: c.subject,
          subscribersCount: c._count.purchases,
          lessonsCount: c._count.lessons,
          purchased: coursePurchased,
          purchaseStatus: coursePurchaseStatus,
        };
      })
    );

    return {
      id: group.id,
      titleEn: group.titleEn,
      titleAr: group.titleAr,
      titleKu: group.titleKu,
      titleTr: group.titleTr,
      description: group.description,
      coverUrl,
      stage: group.stage,
      stageId: group.stageId,
      courseCount: courses.length,
      totalPrice,
      currency: group.currency || currency,
      purchased,
      purchaseStatus,
      courses: mappedCourses,
    };
  }

  static async requestPurchase(groupId: string, userId: string) {
    const detail = await this.getPublic(groupId, userId);
    if (!detail) return { success: false as const, error: "NOT_FOUND" };
    if (detail.courseCount === 0) {
      return { success: false as const, error: "EMPTY_GROUP" };
    }
    if (detail.purchaseStatus === "PAID") {
      return { success: false as const, error: "ALREADY_PURCHASED" };
    }
    if (detail.purchaseStatus === "PENDING") {
      return { success: false as const, error: "ALREADY_PENDING" };
    }

    const purchase = await prisma.courseGroupPurchase.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: {
        groupId,
        userId,
        price: detail.totalPrice,
        currency: detail.currency,
        status: "PENDING",
        source: "REQUEST",
      },
      update: {
        price: detail.totalPrice,
        currency: detail.currency,
        status: "PENDING",
        source: "REQUEST",
        approvedAt: null,
        approvedById: null,
      },
    });

    return { success: true as const, purchase };
  }

  static async listPendingPurchases() {
    return prisma.courseGroupPurchase.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: { select: { id: true, fullLegalName: true, phone: true } },
        group: {
          select: {
            id: true,
            titleEn: true,
            stage: { select: { nameEn: true } },
            items: { select: { courseId: true } },
          },
        },
      },
    });
  }

  /** Approve group purchase and unlock every member course. */
  static async approvePurchase(purchaseId: string, actorId: string) {
    const purchase = await prisma.courseGroupPurchase.findUnique({
      where: { id: purchaseId },
      include: {
        group: {
          include: {
            items: {
              include: {
                course: {
                  include: { teacher: true },
                },
              },
            },
          },
        },
        user: { select: { id: true, fullLegalName: true } },
      },
    });
    if (!purchase || purchase.status !== "PENDING") {
      return { success: false as const, error: "INVALID_PURCHASE" };
    }

    const courses = purchase.group.items
      .map((i) => i.course)
      .filter((c) => c.status === "APPROVED" && !c.deletedAt);

    const months =
      courses.reduce((m, c) => Math.max(m, c.accessMonths > 0 ? c.accessMonths : 10), 10) ||
      10;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + months);

    await prisma.$transaction(async (tx) => {
      await tx.courseGroupPurchase.update({
        where: { id: purchaseId },
        data: {
          status: "PAID",
          approvedById: actorId,
          approvedAt: new Date(),
          expiresAt,
          source: "ADMIN",
        },
      });

      for (const course of courses) {
        const level = course.teacher.level;
        const deductionPct = await TeacherCourseService.getDeductionPct(level);
        const platformAmount = Math.round(course.price * deductionPct) / 100;
        const teacherAmount =
          Math.round(course.price * (100 - deductionPct)) / 100;

        await tx.coursePurchase.upsert({
          where: {
            courseId_userId: { courseId: course.id, userId: purchase.userId },
          },
          create: {
            courseId: course.id,
            userId: purchase.userId,
            price: course.price,
            currency: course.currency,
            teacherLevel: level,
            deductionPct,
            platformAmount,
            teacherAmount,
            status: "PAID",
            approvedById: actorId,
            approvedAt: new Date(),
            expiresAt,
            source: "ADMIN",
          },
          update: {
            price: course.price,
            currency: course.currency,
            teacherLevel: level,
            deductionPct,
            platformAmount,
            teacherAmount,
            status: "PAID",
            approvedById: actorId,
            approvedAt: new Date(),
            expiresAt,
            source: "ADMIN",
          },
        });
      }
    });

    await LoggingService.log({
      actorId,
      action: "APPROVE_COURSE_GROUP_PURCHASE",
      entityType: "CourseGroupPurchase",
      entityId: purchaseId,
      newValue: {
        groupId: purchase.groupId,
        courseIds: courses.map((c) => c.id),
      },
    });

    const firstCourseId = courses[0]?.id;
    await NotificationService.notifyUser(
      purchase.userId,
      {
        titleEn: "Course group unlocked",
        titleAr: "تم فتح مجموعة الدورات",
        titleKu: "کۆمەڵەی کۆرسەکان کرایەوە",
        titleTr: "Kurs grubunun kilidi açıldı",
        bodyEn: `"${purchase.group.titleEn}" is now available (${courses.length} courses).`,
        bodyAr: `"${purchase.group.titleEn}" متاحة الآن (${courses.length} دورات).`,
        bodyKu: `"${purchase.group.titleEn}" ئێستا بەردەستە (${courses.length} کۆرس).`,
        bodyTr: `"${purchase.group.titleEn}" artık kullanılabilir (${courses.length} kurs).`,
      },
      firstCourseId
        ? { type: "subscription", courseId: firstCourseId, screen: "course" }
        : { type: "subscription", screen: "course" }
    ).catch(() => {});

    return { success: true as const };
  }

  static async rejectPurchase(purchaseId: string, actorId: string) {
    const purchase = await prisma.courseGroupPurchase.findUnique({
      where: { id: purchaseId },
    });
    if (!purchase || purchase.status !== "PENDING") {
      return { success: false as const, error: "INVALID_PURCHASE" };
    }
    await prisma.courseGroupPurchase.update({
      where: { id: purchaseId },
      data: {
        status: "REJECTED",
        approvedById: actorId,
        approvedAt: new Date(),
      },
    });
    return { success: true as const };
  }

  /** Admin cancels a paid group purchase and revokes PAID access for member courses. */
  static async cancelPurchase(purchaseId: string, actorId: string) {
    const purchase = await prisma.courseGroupPurchase.findUnique({
      where: { id: purchaseId },
      include: {
        group: {
          include: {
            items: { select: { courseId: true } },
          },
        },
      },
    });
    if (!purchase || purchase.status !== "PAID") {
      return { success: false as const, error: "INVALID_PURCHASE" };
    }

    const courseIds = purchase.group.items.map((i) => i.courseId);

    await prisma.$transaction(async (tx) => {
      await tx.courseGroupPurchase.update({
        where: { id: purchaseId },
        data: {
          status: "REJECTED",
          approvedById: actorId,
          approvedAt: new Date(),
          expiresAt: new Date(),
        },
      });

      if (courseIds.length) {
        await tx.coursePurchase.updateMany({
          where: {
            userId: purchase.userId,
            courseId: { in: courseIds },
            status: "PAID",
          },
          data: {
            status: "REJECTED",
            approvedById: actorId,
            approvedAt: new Date(),
            expiresAt: new Date(),
          },
        });
      }
    });

    await LoggingService.log({
      actorId,
      action: "CANCEL_COURSE_GROUP_PURCHASE",
      entityType: "CourseGroupPurchase",
      entityId: purchaseId,
      previousValue: { status: "PAID", groupId: purchase.groupId },
      newValue: { status: "REJECTED", userId: purchase.userId, courseIds },
    });

    await NotificationService.notifyUser(purchase.userId, {
      titleEn: "Course group access cancelled",
      titleAr: "تم إلغاء الوصول لمجموعة الدورات",
      titleKu: "دەستگەیشتن بە کۆمەڵەی کۆرس هەڵوەشایەوە",
      titleTr: "Kurs grubu erişimi iptal edildi",
      bodyEn: `Your access to "${purchase.group.titleEn}" was cancelled by admin.`,
      bodyAr: `تم إلغاء وصولك إلى "${purchase.group.titleEn}" بواسطة المسؤول.`,
      bodyKu: `دەستگەیشتنت بۆ "${purchase.group.titleEn}" لەلایەن ئەدمینەوە هەڵوەشایەوە.`,
      bodyTr: `"${purchase.group.titleEn}" grubuna erişiminiz yönetici tarafından iptal edildi.`,
    }).catch(() => {});

    return { success: true as const };
  }
}
