import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NotificationService } from "@/services/notification.service";
import { z } from "zod";

const schema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().max(1000).optional(),
});

/** Admin: approve or reject a stage-change request. Approval moves the student. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  const { decision, notes } = parsed.data;

  const req = await prisma.stageChangeRequest.findUnique({
    where: { id },
    include: { requestedStage: true },
  });
  if (!req) return error("Request not found", 404, "NOT_FOUND");
  if (req.status !== "PENDING") return error("Already reviewed", 400, "ALREADY_REVIEWED");

  const updated = await prisma.stageChangeRequest.update({
    where: { id },
    data: {
      status: decision,
      reviewNotes: notes ?? null,
      reviewedById: auth.session.userId,
      reviewedAt: new Date(),
    },
  });

  if (decision === "APPROVED") {
    await prisma.studentProfile.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId, educationalStageId: req.requestedStageId },
      update: { educationalStageId: req.requestedStageId },
    });
  }

  const stageName = req.requestedStage;
  await NotificationService.notifyUser(req.userId, {
    titleEn: decision === "APPROVED" ? "Stage Change Approved" : "Stage Change Rejected",
    titleAr: decision === "APPROVED" ? "تمت الموافقة على تغيير المرحلة" : "تم رفض تغيير المرحلة",
    titleKu: decision === "APPROVED" ? "گۆڕینی قۆناغ پەسەند کرا" : "گۆڕینی قۆناغ ڕەتکرایەوە",
    titleTr: decision === "APPROVED" ? "Aşama Değişikliği Onaylandı" : "Aşama Değişikliği Reddedildi",
    bodyEn:
      decision === "APPROVED"
        ? `You have been moved to ${stageName.nameEn}.`
        : notes || "Your stage change request was not approved.",
    bodyAr:
      decision === "APPROVED"
        ? `تم نقلك إلى ${stageName.nameAr}.`
        : notes || "لم تتم الموافقة على طلب تغيير المرحلة.",
    bodyKu:
      decision === "APPROVED"
        ? `گوازرایتەوە بۆ ${stageName.nameKu}.`
        : notes || "داواکاری گۆڕینی قۆناغەکەت پەسەند نەکرا.",
    bodyTr:
      decision === "APPROVED"
        ? `${stageName.nameTr} aşamasına taşındınız.`
        : notes || "Aşama değişikliği talebiniz onaylanmadı.",
  }).catch(() => {});

  return json({ request: updated });
}
