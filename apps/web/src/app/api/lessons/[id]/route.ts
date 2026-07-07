import { CourseService } from "@/services/course.service";
import { VideoService } from "@/services/video.service";
import { error, json, requireAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { getDownloadUrl } from "@/lib/r2";

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

  const introOutro = await VideoService.getIntroOutro(
    user.locale,
    user.countryId ?? undefined
  );

  // Attach short-lived signed media URLs only when the user may watch.
  let contents = result.lesson.contents;
  if (result.hasAccess) {
    contents = await Promise.all(
      contents.map(async (c) => ({
        ...c,
        fileUrl:
          c.fileUrl ||
          (await getDownloadUrl(c.fileKey, 3 * 3600).catch(() => null)),
      }))
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
