import { CourseService } from "@/services/course.service";
import { VideoService } from "@/services/video.service";
import { error, json, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { resolvePlaybackUrl } from "@/lib/r2";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const user = await getCurrentUser();
  if (!user || user.status === "PENDING") {
    return error("Account pending approval", 403, "PENDING");
  }

  const { id } = await params;
  const result = await CourseService.getLesson(id, user.id);
  if (!result) return error("Lesson not found", 404);

  const introOutro = result.hasAccess
    ? await VideoService.getPlayableIntroOutro(
        user.locale,
        user.countryId ?? undefined
      )
    : { intro: null, outro: null };

  // Attach short-lived signed media URLs only when the user may watch.
  let contents = result.lesson.contents;
  if (result.hasAccess) {
    contents = await Promise.all(
      contents.map(async (c) => {
        const fileUrl = await resolvePlaybackUrl(c.fileKey, c.fileUrl);
        return { ...c, fileUrl };
      })
    );
  } else {
    contents = contents.map((c) => ({ ...c, fileUrl: null, fileKey: "" }));
  }

  return json({
    ...result,
    lesson: { ...result.lesson, contents },
    introOutro,
  });
}
