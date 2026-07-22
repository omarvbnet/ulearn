import { error, json, rateLimit, requireAuth, getClientIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { VideoAssetService } from "@/services/video-asset.service";
import { z } from "zod";
import type { VideoScope } from "@prisma/client";

const bodySchema = z.object({
  courseId: z.string().min(1).optional(),
  scope: z.enum(["STORE_COURSE", "CURRICULUM_LESSON", "SHORT_VIDEO"]).default("STORE_COURSE"),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
}).refine((d) => d.scope === "SHORT_VIDEO" || Boolean(d.courseId), {
  message: "courseId is required for this scope",
  path: ["courseId"],
});

async function verifyCourseAccess(userId: string, role: string, courseId: string) {
  if (["SUPER_ADMIN", "COUNTRY_ADMIN"].includes(role)) return true;
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null, teacher: { userId, deletedAt: null } },
  });
  return Boolean(course);
}

/** Direct-to-R2 signed upload URL. Video bytes never pass through Next.js. */
export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER", "SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const ip = getClientIp(request) || auth.session.userId;
  const rl = rateLimit(`video-upload:${ip}`, 30, 60_000);
  if (!rl.allowed) return error("Too many upload requests", 429, "RATE_LIMIT");

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  if (parsed.data.scope !== "SHORT_VIDEO") {
    if (!(await verifyCourseAccess(auth.session.userId, auth.session.role, parsed.data.courseId!))) {
      return error("Course not found or access denied", 403, "FORBIDDEN");
    }
  } else if (!["TEACHER", "SUPER_ADMIN", "COUNTRY_ADMIN"].includes(auth.session.role)) {
    return error("Forbidden", 403, "FORBIDDEN");
  }

  try {
    const session = await VideoAssetService.createUploadSession({
      userId: auth.session.userId,
      role: auth.session.role,
      scope: parsed.data.scope as VideoScope,
      courseId: parsed.data.courseId,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
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
