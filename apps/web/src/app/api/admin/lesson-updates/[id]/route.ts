import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { notifySubscribersLessonUpdated } from "@/services/engagement-notifications.service";
import { z } from "zod";

/** Admin: approve or reject a pending lesson update. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = (await request.json()) as { decision?: "APPROVED" | "REJECTED"; notes?: string };
  if (!body.decision) return error("decision required", 422, "VALIDATION");

  const req = await prisma.courseLessonUpdateRequest.findUnique({
    where: { id },
    include: {
      lesson: {
        include: {
          course: {
            select: {
              id: true,
              titleEn: true,
              purchases: { where: { status: "PAID" }, select: { userId: true } },
            },
          },
        },
      },
    },
  });
  if (!req || req.status !== "PENDING") return error("Request not found", 404);

  if (body.decision === "REJECTED") {
    await prisma.courseLessonUpdateRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewNotes: body.notes ?? null,
        reviewedById: auth.session.userId,
        reviewedAt: new Date(),
      },
    });
    return json({ success: true, status: "REJECTED" });
  }

  await prisma.courseLesson.update({
    where: { id: req.lessonId },
    data: {
      ...(req.title ? { title: req.title } : {}),
      ...(req.fileKey ? { fileKey: req.fileKey } : {}),
      ...(req.fileUrl ? { fileUrl: req.fileUrl } : {}),
      ...(req.thumbnailKey ? { thumbnailKey: req.thumbnailKey } : {}),
      ...(req.thumbnailUrl ? { thumbnailUrl: req.thumbnailUrl } : {}),
      ...(req.durationSec != null ? { durationSec: req.durationSec } : {}),
    },
  });

  await prisma.courseLessonUpdateRequest.update({
    where: { id },
    data: {
      status: "APPROVED",
      reviewNotes: body.notes ?? null,
      reviewedById: auth.session.userId,
      reviewedAt: new Date(),
    },
  });

  const subscriberIds = req.lesson.course.purchases.map((p) => p.userId);
  if (subscriberIds.length > 0) {
    await notifySubscribersLessonUpdated({
      userIds: subscriberIds,
      courseTitle: req.lesson.course.titleEn,
      lessonTitle: req.title ?? req.lesson.title,
    });
  }

  return json({ success: true, status: "APPROVED" });
}
