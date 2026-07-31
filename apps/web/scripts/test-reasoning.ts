import { ReasoningEngine } from "../src/services/classroom-engine/services/reasoning-engine";

async function main() {
  try {
    const out = await ReasoningEngine.reason(
      {
        move: "explain",
        phase: "concept_explanation",
        strategy: "direct_instruction",
        speechLanguage: "ar",
        uiLanguage: "ar",
        countryCode: "IQ",
        provinceName: null,
        lesson: {
          lessonName: "قانون نيوتن الأول في الحركة",
          objective: "فهم قانون نيوتن الأول (القصور الذاتي)",
          conceptOutline: ["القصور الذاتي", "القوة المحصلة"],
          curriculumOutline: ["قانون نيوتن الأول في الحركة"],
          documentIds: [],
          materialNames: ["فيزياء الثالث متوسط"],
        },
        memory: {
          masteredConcepts: [],
          weakConcepts: [],
          completedLessons: [],
          preferences: null,
          mistakes: [],
        },
        knowledge: [
          {
            text: "ينص قانون نيوتن الأول على أن الجسم الساكن يبقى ساكناً والجسم المتحرك يبقى متحركاً بسرعة ثابتة ما لم تؤثر فيه قوة خارجية محصلة.",
            documentName: "فيزياء الثالث متوسط",
            page: null,
          },
        ],
        pedagogy: {
          strategy: "direct_instruction",
          emotion: "encouraging",
          pace: "normal",
          rationale: "test",
        },
        recentSpeak: [],
        boardSummary: [],
        pendingQuestion: null,
        studentTranscript: undefined,
      } as never,
      (p) => console.log("PARTIAL:", JSON.stringify(p)),
      undefined
    );
    console.log("SPEAK:", JSON.stringify(out.speak, null, 2));
    console.log("BOARD:", JSON.stringify(out.boardInstructions));
    console.log("TOPIC:", out.topic, "| EMOTION:", out.emotion, "| PACE:", out.pace);
    const isFallback = out.speak.some((s) => s.includes("شوف الفكرة وياي"));
    console.log(isFallback ? "RESULT: FALLBACK (still broken)" : "RESULT: REAL OUTPUT (fixed)");
  } catch (e) {
    console.error("REASON FAILED:", e);
  }
  process.exit(0);
}

void main();
