import { error, json, rateLimit, requireAuth, getClientIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { isWhiteboardLessonsEnabled } from "@/lib/whiteboard-feature";
import { WhiteboardAssetService } from "@/services/whiteboard-asset.service";
import { z } from "zod";
import type { WhiteboardTheme } from "@prisma/client";

const bodySchema = z.object({
  courseId: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1).default("application/octet-stream"),
  size: z.number().int().positive(),
  theme: z.enum(["WHITE", "BLACK", "GREEN"]).optional(),
});

async function verifyCourseAccess(userId: string, role: string, courseId: string) {
  if (["SUPER_ADMIN", "COUNTRY_ADMIN"].includes(role)) return true;
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null, teacher: { userId, deletedAt: null } },
  });
  return Boolean(course);
}

/** Direct-to-R2 signed upload URL for .ubrd packages. Bytes never pass through Next.js. */
export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER", "SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  if (!(await isWhiteboardLessonsEnabled())) {
    return error("Whiteboard lessons are disabled by admin", 403, "FEATURE_DISABLED");
  }

  const ip = getClientIp(request) || auth.session.userId;
  const rl = rateLimit(`whiteboard-upload:${ip}`, 30, 60_000);
  if (!rl.allowed) return error("Too many upload requests", 429, "RATE_LIMIT");

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  if (!(await verifyCourseAccess(auth.session.userId, auth.session.role, parsed.data.courseId))) {
    return error("Course not found or access denied", 403, "FORBIDDEN");
  }

  try {
    const session = await WhiteboardAssetService.createUploadSession({
      userId: auth.session.userId,
      role: auth.session.role,
      courseId: parsed.data.courseId,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
      theme: parsed.data.theme as WhiteboardTheme | undefined,
    });
    return json(session, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "UPLOAD_SETUP_FAILED";
    if (msg === "FORBIDDEN") return error("Forbidden", 403, "FORBIDDEN");
    if (msg === "INVALID_FILE_TYPE" || msg === "FILE_TOO_LARGE") {
      return error(msg, 422, msg);
    }
    return error("Could not create upload session", 500, "UPLOAD_SETUP_FAILED");
  }
}
