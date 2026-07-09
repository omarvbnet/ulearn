import { error, json, requireAuth } from "@/lib/api";
import { CourseRatingService } from "@/services/course-rating.service";
import { z } from "zod";

const schema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

/** Submit or update a 5-star evaluation after completing a course and its quizzes. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER", "TEACHER"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await CourseRatingService.submit({
    courseId: id,
    userId: auth.session.userId,
    rating: parsed.data.rating,
    comment: parsed.data.comment,
  });

  if (!result.success) {
    if (result.error === "NOT_FOUND") return error("Course not found", 404, "NOT_FOUND");
    if (result.error === "COURSE_NOT_COMPLETE") {
      return error("Finish all lessons and quizzes before evaluating", 400, "COURSE_NOT_COMPLETE");
    }
    if (result.error === "NO_ACCESS") return error("No access", 403, "FORBIDDEN");
    return error("Invalid rating", 422, "VALIDATION");
  }

  return json({
    rating: result.rating.rating,
    comment: result.rating.comment,
    courseRating: result.courseRating,
    courseRatingCount: result.courseRatingCount,
  });
}
