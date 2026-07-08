import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { ShortVideoAdminService } from "@/services/short-video-admin.service";
import type { CourseStatus } from "@prisma/client";

/** Admin: list short videos for review. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") ?? "PENDING_REVIEW") as CourseStatus;

  const videos = await ShortVideoAdminService.listForReview(status);
  return json({ videos });
}
