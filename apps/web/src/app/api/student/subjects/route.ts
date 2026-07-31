import { error, json, requireAuth } from "@/lib/api";
import { SubjectAssessmentService } from "@/services/assessment/subject-assessment.service";

/** Every Subject Scorecard the student has recorded activity for. */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const subjects = await SubjectAssessmentService.listScorecardsForUser(auth.session.userId);
    return json({ subjects });
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Failed to load subject scorecards",
      500,
      "SUBJECT_SCORECARDS"
    );
  }
}
