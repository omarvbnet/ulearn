import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { ContentReportService } from "@/services/content-report.service";
import type { ContentReportStatus } from "@prisma/client";

/** Admin: list content reports. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") ?? "PENDING") as ContentReportStatus;

  const reports = await ContentReportService.listForAdmin(status);
  return json({ reports });
}
