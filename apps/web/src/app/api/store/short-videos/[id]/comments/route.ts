import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { notifyTeacherShortVideoComment } from "@/services/engagement-notifications.service";
import { ShortVideoService } from "@/services/short-video.service";
import { z } from "zod";

const schema = z.object({
  body: z.string().min(1).max(2000),
  parentId: z.string().optional(),
});

/** List comments on a short video. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await ShortVideoService.listComments(id);
  if (!result.success) return error("Video not found", 404, "NOT_FOUND");

  return json({ comments: result.comments });
}

/** Post a comment on a short video. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid comment", 422, "VALIDATION");

  const result = await ShortVideoService.addComment({
    videoId: id,
    userId: auth.session.userId,
    body: parsed.data.body,
    parentId: parsed.data.parentId,
  });
  if (!result.success) {
    if (result.error === "INVALID_PARENT") return error("Invalid reply target", 422, "VALIDATION");
    return error("Video not found", 404, "NOT_FOUND");
  }

  if (result.teacherUserId !== auth.session.userId) {
    const user = await getCurrentUser();
    await notifyTeacherShortVideoComment({
      teacherUserId: result.teacherUserId,
      videoTitle: result.videoTitle,
      commenterName: user?.fullLegalName ?? "Someone",
      comment: parsed.data.body,
    });
  }

  const count = await prisma.shortVideoComment.count({
    where: { videoId: id, deletedAt: null },
  });

  return json({ comment: result.comment, commentCount: count }, 201);
}
