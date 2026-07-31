import type { EngineSessionState, LessonPlan, SpeechLang } from "../types";

export class RecommendationEngine {
  static nextLesson(
    plan: LessonPlan,
    state: EngineSessionState
  ): { lessonName: string | null; sessionComplete: boolean; message: string } {
    const outline = plan.curriculumOutline;
    const current = state.lessonName || plan.lessonName;
    const idx = outline.indexOf(current);
    const next = idx >= 0 ? outline[idx + 1] : outline[1] || null;
    const speech = state.speechLanguage;
    if (!next) {
      return {
        lessonName: null,
        sessionComplete: true,
        message: doneMessage(speech, current),
      };
    }
    return {
      lessonName: next,
      sessionComplete: false,
      message: nextMessage(speech, next),
    };
  }
}

function doneMessage(speech: SpeechLang, lesson: string) {
  if (speech === "ar") return `أحسنت! أنهينا ${lesson}. عمل رائع اليوم.`;
  if (speech === "tr") return `Aferin! ${lesson} konusunu bitirdik. Harika iş.`;
  return `Well done — we finished ${lesson}. Excellent work today.`;
}

function nextMessage(speech: SpeechLang, next: string) {
  if (speech === "ar") return `ممتاز. الدرس التالي: ${next}.`;
  if (speech === "tr") return `Harika. Sonraki ders: ${next}.`;
  return `Great. Next lesson: ${next}.`;
}
