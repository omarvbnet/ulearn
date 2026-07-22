import { error, json, requireAuth } from "@/lib/api";
import { ContentReportService } from "@/services/content-report.service";
import type { ContentReportReason, ContentReportTargetType } from "@prisma/client";

const REPORT_ROLES = ["STUDENT", "CERTIFICATE_USER", "TEACHER"] as const;

/** Submit a content report. */
export async function POST(request: Request) {
  const auth = await requireAuth([...REPORT_ROLES]);
  if (auth.error) return auth.error;

  const { targetType, targetId, reason, details } = (await request.json()) as {
    targetType?: ContentReportTargetType;
    targetId?: string;
    reason?: ContentReportReason;
    details?: string;
  };

  if (!targetType || !targetId || !reason || !details?.trim()) {
    return error("targetType, targetId, reason, and details are required", 422, "VALIDATION");
  }

  const validReasons: ContentReportReason[] = [
    "INAPPROPRIATE",
    "SPAM",
    "HARASSMENT",
    "COPYRIGHT",
    "VIOLENCE",
    "MISLEADING",
    "OTHER",
  ];
  if (!validReasons.includes(reason)) {
    return error("Invalid reason", 422, "VALIDATION");
  }

  const result = await ContentReportService.submit({
    reporterId: auth.session.userId,
    targetType,
    targetId,
    reason,
    details,
  });

  if (!result.success) {
    const code = result.error;
    if (code === "DETAILS_TOO_SHORT") {
      return error("Please provide at least 10 characters describing the issue", 422, code);
    }
    if (code === "OTHER_REQUIRES_DETAILS") {
      return error("Please provide more detail when selecting Other (min 20 characters)", 422, code);
    }
    if (code === "ALREADY_REPORTED") {
      return error("You already reported this content", 409, code);
    }
    if (code === "OWN_CONTENT") {
      return error("You cannot report your own content", 403, code);
    }
    return error("Content not found", 404, code);
  }

  return json({ report: result.report }, 201);
}

/** List the current user's content reports. */
export async function GET() {
  const auth = await requireAuth([...REPORT_ROLES]);
  if (auth.error) return auth.error;

  const reports = await ContentReportService.listForUser(auth.session.userId);
  return json({ reports });
}
