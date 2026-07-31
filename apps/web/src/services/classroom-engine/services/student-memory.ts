import { StudentMemoryService } from "@/services/ai/student-memory.service";
import type { StudentMemorySnapshot } from "../types";

/** Persistent long-term student memory for the Classroom Engine. */
export class ClassroomMemoryService {
  static async load(
    userId: string,
    documentIds: string[]
  ): Promise<StudentMemorySnapshot> {
    const materialsKey = StudentMemoryService.materialsKey(documentIds);
    const [memory, mastery, progress] = await Promise.all([
      StudentMemoryService.getOrCreate(userId),
      materialsKey
        ? StudentMemoryService.getConceptMastery(userId, materialsKey)
        : Promise.resolve({} as Record<string, { score: number; status?: string }>),
      materialsKey
        ? StudentMemoryService.getMaterialProgress(userId, materialsKey)
        : Promise.resolve(null),
    ]);

    const mastered: string[] = [];
    const weak: string[] = [];
    for (const [k, v] of Object.entries(mastery || {})) {
      const status = String((v as { status?: string }).status || "");
      const score = Number((v as { score?: number }).score || 0);
      if (status === "mastered" || score >= 0.8) mastered.push(k);
      else if (status === "weak" || score <= 0.35) weak.push(k);
    }

    return {
      completedLessons: progress?.completedLessons || [],
      masteredConcepts: mastered.slice(-16),
      weakConcepts: weak.slice(-12),
      mistakes: (progress?.mistakes || []).slice(-12),
      interests: (memory.strongSubjects || []).slice(-8),
      discussionNotes: [],
      homework: [],
      quizHistory: [],
      preferenceBlurb: StudentMemoryService.toPromptBlurb(memory),
    };
  }

  static async persistProgress(input: {
    userId: string;
    documentIds: string[];
    materialNames: string[];
    curriculumOutline: string[];
    lessonName: string | null;
    understanding: number;
    confidence: number;
    learningSpeed: "slow" | "normal" | "fast";
    mistakes: string[];
    completedLesson?: string | null;
  }) {
    const materialsKey = StudentMemoryService.materialsKey(input.documentIds);
    if (!materialsKey || !input.lessonName) return;
    await StudentMemoryService.saveMaterialProgress(input.userId, materialsKey, {
      lessonName: input.lessonName,
      lessonIndex: input.curriculumOutline.indexOf(input.lessonName),
      materialNames: input.materialNames,
      curriculumOutline: input.curriculumOutline,
      understanding: input.understanding,
      confidence: input.confidence,
      learningSpeed: input.learningSpeed,
      mistakes: input.mistakes,
    });
    if (input.completedLesson) {
      await StudentMemoryService.markLessonCompleted(
        input.userId,
        materialsKey,
        input.completedLesson
      );
    }
  }

  static async saveLanguage(userId: string, language: string) {
    void StudentMemoryService.savePreferredLanguage(userId, language);
  }
}
