import { error, json, requireAuth } from "@/lib/api";
import { ClassroomSessionService } from "@/services/ai/classroom/classroom-session.service";

/** The student's AI-teacher evaluations, one entry per studied material. */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const evaluations = await ClassroomSessionService.listEvaluations(
      auth.session.userId
    );
    return json({ evaluations });
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Failed to load evaluations",
      500,
      "CLASSROOM_EVALUATIONS"
    );
  }
}
