import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { LoggingService } from "@/services/logging.service";

/** Admin: resolve or dismiss a complaint. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const { status, resolution } = (await request.json()) as {
    status?: "RESOLVED" | "DISMISSED" | "IN_PROGRESS";
    resolution?: string;
  };

  if (!status) return error("status is required", 422, "VALIDATION");

  const complaint = await prisma.complaint.update({
    where: { id },
    data: {
      status,
      resolution: resolution || null,
      handledById: auth.session.userId,
      resolvedAt: status === "RESOLVED" || status === "DISMISSED" ? new Date() : null,
    },
  });

  await LoggingService.log({
    actorId: auth.session.userId,
    action: `COMPLAINT_${status}`,
    entityType: "Complaint",
    entityId: id,
  });

  return json({ complaint });
}
