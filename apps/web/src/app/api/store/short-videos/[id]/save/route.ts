import { error, json, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { notifyTeacherShortVideoSave } from "@/services/engagement-notifications.service";
import { ShortVideoService } from "@/services/short-video.service";

/** Save or unsave a short video. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await ShortVideoService.toggleSave(id, auth.session.userId);
  if (!result.success) return error("Video not found", 404, "NOT_FOUND");

  if (
    result.savedByMe &&
    result.teacherUserId &&
    result.teacherUserId !== auth.session.userId
  ) {
    const saver = await getCurrentUser();
    await notifyTeacherShortVideoSave({
      teacherUserId: result.teacherUserId,
      videoTitle: result.videoTitle ?? "Reel",
      saverName: saver?.fullLegalName ?? "Someone",
      shortVideoId: id,
    });
  }

  return json({ savedByMe: result.savedByMe, saves: result.saves });
}
