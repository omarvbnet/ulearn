import { error, json, requireAuth } from "@/lib/api";
import { StudentMemoryService } from "@/services/ai/student-memory.service";

/** The student's AI-teacher evaluations, one entry per studied material. */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const entries = await StudentMemoryService.listMaterialEvaluations(
      auth.session.userId
    );
    const evaluations = entries.map((e) => ({
      materialsKey: e.materialsKey,
      materialNames: e.materialNames || [],
      lessonName: e.lessonName || null,
      lessonIndex: e.lessonIndex,
      totalLessons:
        e.evaluation?.totalLessons ?? (e.curriculumOutline || []).length ?? 0,
      understanding: typeof e.understanding === "number" ? e.understanding : null,
      confidence: typeof e.confidence === "number" ? e.confidence : null,
      updatedAt: e.updatedAt,
      evaluation: e.evaluation || null,
      completedLessonsCount: e.completedLessons?.length || 0,
      masteredCount: e.masteredCount || 0,
      weakCount: e.weakCount || 0,
    }));
    return json({ evaluations });
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Failed to load evaluations",
      500,
      "CLASSROOM_EVALUATIONS"
    );
  }
}
