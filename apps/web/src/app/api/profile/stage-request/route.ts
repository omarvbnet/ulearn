import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const stageSelect = {
  select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
};

/** Student: own stage-change requests, newest first. */
export async function GET() {
  const auth = await requireAuth(["STUDENT"]);
  if (auth.error) return auth.error;

  const requests = await prisma.stageChangeRequest.findMany({
    where: { userId: auth.session.userId },
    orderBy: { createdAt: "desc" },
    include: { currentStage: stageSelect, requestedStage: stageSelect },
  });

  return json({ requests });
}

const createSchema = z.object({
  requestedStageId: z.string().min(1),
  certificateKey: z.string().optional(),
  certificateUrl: z.string().optional(),
  note: z.string().max(1000).optional(),
});

/** Student: request a move to a different stage, attaching a certificate for admin review. */
export async function POST(request: Request) {
  const auth = await requireAuth(["STUDENT"]);
  if (auth.error) return auth.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  const { requestedStageId, certificateKey, certificateUrl, note } = parsed.data;

  if (!certificateKey && !certificateUrl) {
    return error("A certificate attachment is required", 422, "CERTIFICATE_REQUIRED");
  }

  const stage = await prisma.educationalStage.findFirst({
    where: { id: requestedStageId, isActive: true, deletedAt: null },
  });
  if (!stage) return error("Stage not found", 404, "STAGE_NOT_FOUND");

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: auth.session.userId },
  });
  if (profile?.educationalStageId === requestedStageId) {
    return error("You are already in this stage", 400, "SAME_STAGE");
  }

  const pending = await prisma.stageChangeRequest.findFirst({
    where: { userId: auth.session.userId, status: "PENDING" },
  });
  if (pending) {
    return error("You already have a pending stage request", 400, "ALREADY_PENDING");
  }

  const created = await prisma.stageChangeRequest.create({
    data: {
      userId: auth.session.userId,
      currentStageId: profile?.educationalStageId ?? null,
      requestedStageId,
      certificateKey,
      certificateUrl,
      note,
    },
    include: { currentStage: stageSelect, requestedStage: stageSelect },
  });

  return json({ request: created }, 201);
}
