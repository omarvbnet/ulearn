import { prisma } from "@/lib/prisma";
import type { ContentReportReason, ContentReportTargetType } from "@prisma/client";

const REASON_LABELS: Record<ContentReportReason, string> = {
  INAPPROPRIATE: "Inappropriate content",
  SPAM: "Spam or misleading",
  HARASSMENT: "Harassment or hate speech",
  COPYRIGHT: "Copyright violation",
  VIOLENCE: "Violence or dangerous acts",
  MISLEADING: "False or misleading information",
  OTHER: "Other",
};

export class ContentReportService {
  static reasonLabels = REASON_LABELS;

  static async submit(params: {
    reporterId: string;
    targetType: ContentReportTargetType;
    targetId: string;
    reason: ContentReportReason;
    details: string;
  }) {
    const details = params.details.trim();
    if (details.length < 10) {
      return { success: false as const, error: "DETAILS_TOO_SHORT" as const };
    }
    if (params.reason === "OTHER" && details.length < 20) {
      return { success: false as const, error: "OTHER_REQUIRES_DETAILS" as const };
    }

    const ownership = await this.verifyTargetAndOwnership(
      params.targetType,
      params.targetId,
      params.reporterId
    );
    if (!ownership.ok) return { success: false as const, error: ownership.error };

    const existing = await prisma.contentReport.findUnique({
      where: {
        reporterId_targetType_targetId: {
          reporterId: params.reporterId,
          targetType: params.targetType,
          targetId: params.targetId,
        },
      },
    });
    if (existing) {
      return { success: false as const, error: "ALREADY_REPORTED" as const };
    }

    const report = await prisma.contentReport.create({
      data: {
        reporterId: params.reporterId,
        targetType: params.targetType,
        targetId: params.targetId,
        reason: params.reason,
        details,
      },
    });

    return { success: true as const, report };
  }

  static async verifyTargetAndOwnership(
    targetType: ContentReportTargetType,
    targetId: string,
    reporterId: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (targetType === "SHORT_VIDEO") {
      const video = await prisma.teacherShortVideo.findFirst({
        where: { id: targetId, deletedAt: null, status: "APPROVED" },
        include: { teacher: { select: { userId: true } } },
      });
      if (!video) return { ok: false, error: "NOT_FOUND" };
      if (video.teacher.userId === reporterId) return { ok: false, error: "OWN_CONTENT" };
      return { ok: true };
    }

    if (targetType === "SHORT_VIDEO_COMMENT") {
      const comment = await prisma.shortVideoComment.findFirst({
        where: { id: targetId, deletedAt: null },
        include: { user: { select: { id: true } } },
      });
      if (!comment) return { ok: false, error: "NOT_FOUND" };
      if (comment.userId === reporterId) return { ok: false, error: "OWN_CONTENT" };
      return { ok: true };
    }

    if (targetType === "STORE_COURSE") {
      const course = await prisma.course.findFirst({
        where: { id: targetId, deletedAt: null, status: "APPROVED" },
        include: { teacher: { select: { userId: true } } },
      });
      if (!course) return { ok: false, error: "NOT_FOUND" };
      if (course.teacher.userId === reporterId) return { ok: false, error: "OWN_CONTENT" };
      return { ok: true };
    }

    if (targetType === "STORE_LESSON") {
      const lesson = await prisma.courseLesson.findFirst({
        where: {
          id: targetId,
          course: { deletedAt: null, status: "APPROVED" },
        },
        include: { course: { include: { teacher: { select: { userId: true } } } } },
      });
      if (!lesson) return { ok: false, error: "NOT_FOUND" };
      if (lesson.course.teacher.userId === reporterId) return { ok: false, error: "OWN_CONTENT" };
      return { ok: true };
    }

    return { ok: false, error: "INVALID_TARGET" };
  }

  static async listForUser(reporterId: string) {
    return prisma.contentReport.findMany({
      where: { reporterId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  static async listForAdmin(status: "PENDING" | "REVIEWED" | "DISMISSED" | "ACTION_TAKEN" = "PENDING") {
    const reports = await prisma.contentReport.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        reporter: { select: { fullLegalName: true, phone: true, role: true } },
      },
    });

    return Promise.all(
      reports.map(async (r) => ({
        ...r,
        targetSummary: await this.targetSummary(r.targetType, r.targetId),
      }))
    );
  }

  static async targetSummary(targetType: ContentReportTargetType, targetId: string) {
    if (targetType === "SHORT_VIDEO") {
      const v = await prisma.teacherShortVideo.findUnique({
        where: { id: targetId },
        select: { title: true, teacher: { select: { user: { select: { fullLegalName: true } } } } },
      });
      return v
        ? { title: v.title, subtitle: v.teacher.user.fullLegalName }
        : { title: "Removed content", subtitle: null };
    }
    if (targetType === "SHORT_VIDEO_COMMENT") {
      const c = await prisma.shortVideoComment.findUnique({
        where: { id: targetId },
        select: {
          body: true,
          user: { select: { fullLegalName: true } },
          video: { select: { title: true } },
        },
      });
      return c
        ? {
            title: c.body.slice(0, 80),
            subtitle: `${c.video.title} · ${c.user.fullLegalName}`,
          }
        : { title: "Removed comment", subtitle: null };
    }
    if (targetType === "STORE_COURSE") {
      const c = await prisma.course.findUnique({
        where: { id: targetId },
        select: { titleEn: true, teacher: { select: { user: { select: { fullLegalName: true } } } } },
      });
      return c
        ? { title: c.titleEn, subtitle: c.teacher.user.fullLegalName }
        : { title: "Removed course", subtitle: null };
    }
    const l = await prisma.courseLesson.findUnique({
      where: { id: targetId },
      select: {
        title: true,
        course: {
          select: { titleEn: true, teacher: { select: { user: { select: { fullLegalName: true } } } } },
        },
      },
    });
    return l
      ? { title: l.title, subtitle: `${l.course.titleEn} · ${l.course.teacher.user.fullLegalName}` }
      : { title: "Removed lesson", subtitle: null };
  }

  static async review(
    reportId: string,
    actorId: string,
    status: "REVIEWED" | "DISMISSED" | "ACTION_TAKEN",
    adminNotes?: string
  ) {
    const report = await prisma.contentReport.findUnique({ where: { id: reportId } });
    if (!report || report.status !== "PENDING") {
      return { success: false as const, error: "NOT_FOUND" };
    }

    const updated = await prisma.contentReport.update({
      where: { id: reportId },
      data: {
        status,
        adminNotes: adminNotes ?? null,
        reviewedById: actorId,
        reviewedAt: new Date(),
      },
    });

    return { success: true as const, report: updated };
  }
}
