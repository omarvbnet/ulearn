import { KnowledgeRetrievalService } from "./knowledge-retrieval";
import type { LessonPlan, SpeechLang } from "../types";

/** Lesson Planner — builds the curriculum path for a session. */
export class LessonPlanner {
  static async plan(input: {
    userId: string;
    documentIds: string[];
    question?: string;
    speechLanguage: SpeechLang;
    completedLessons?: string[];
  }): Promise<{ plan: LessonPlan }> {
    const { plan } = await KnowledgeRetrievalService.buildLessonPlan({
      userId: input.userId,
      documentIds: input.documentIds,
      question: input.question,
      speechLanguage: input.speechLanguage,
    });
    const next = plan.curriculumOutline.find(
      (l) => !(input.completedLessons || []).includes(l)
    );
    if (next) {
      plan.lessonName = next;
      plan.objective = next;
    }
    return { plan };
  }
}
