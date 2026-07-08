import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { ContentReportService } from "@/services/content-report.service";

/** Admin: review a content report. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const { status, adminNotes } = (await request.json()) as {
    status?: "REVIEWED" | "DISMISSED" | "ACTION_TAKEN";
    adminNotes?: string;
  };

  if (!status) return error("status is required", 422, "VALIDATION");

  const result = await ContentReportService.review(id, auth.session.userId, status, adminNotes);
  if (!result.success) return error("Report not found or already handled", 404, "NOT_FOUND");

  return json({ report: result.report });
}
