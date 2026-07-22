import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { ShortVideoAdminService } from "@/services/short-video-admin.service";

/** Admin: approve or reject a short video. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const { decision, notes } = (await request.json()) as {
    decision?: "APPROVED" | "REJECTED";
    notes?: string;
  };

  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return error("decision must be APPROVED or REJECTED", 422, "VALIDATION");
  }

  const result = await ShortVideoAdminService.review(id, auth.session.userId, decision, notes);
  if (!result.success) return error("Video not found or already reviewed", 404, "NOT_FOUND");

  return json({ video: result.video });
}
