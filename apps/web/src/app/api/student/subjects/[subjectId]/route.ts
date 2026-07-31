import { error, json, requireAuth } from "@/lib/api";
import { SubjectAssessmentService } from "@/services/assessment/subject-assessment.service";

/** The full multi-dimensional scorecard for one Subject. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ subjectId: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const { subjectId } = await params;
    const scorecard = await SubjectAssessmentService.getScorecard(auth.session.userId, subjectId);
    if (!scorecard) return error("No scorecard found for this subject yet", 404, "NOT_FOUND");
    return json({ scorecard });
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Failed to load subject scorecard",
      500,
      "SUBJECT_SCORECARD"
    );
  }
}
