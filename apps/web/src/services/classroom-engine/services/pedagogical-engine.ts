import type {
  PedagogyPlan,
  StudentMemorySnapshot,
  StudentProfileSnapshot,
  TeachingStrategy,
} from "../types";

/** Chooses teaching strategy BEFORE any content is generated. */
export class PedagogicalEngine {
  static plan(input: {
    profile: StudentProfileSnapshot;
    memory: StudentMemorySnapshot;
    consecutiveCorrect: number;
    consecutiveWrong: number;
    understanding: number;
    confidence: number;
    phaseHint?: string;
  }): PedagogyPlan {
    const { profile, memory } = input;
    let challengeLevel: PedagogyPlan["challengeLevel"] = "standard";
    if (input.consecutiveWrong >= 2 || input.understanding < 0.35) {
      challengeLevel = "gentle";
    } else if (input.consecutiveCorrect >= 2 && input.confidence > 0.65) {
      challengeLevel = "advanced";
    }

    let strategy: TeachingStrategy = "direct_instruction";
    if (challengeLevel === "gentle" || memory.weakConcepts.length) {
      strategy = "remediation";
    } else if (challengeLevel === "advanced") {
      strategy = "challenge";
    } else if (profile.preferredStyle?.toLowerCase().includes("story")) {
      strategy = "story_analogy";
    } else if (profile.learningSpeed === "slow") {
      strategy = "scaffolded_practice";
    } else if (input.phaseHint === "worked_example") {
      strategy = "worked_example";
    } else if (input.phaseHint === "guided_practice") {
      strategy = "scaffolded_practice";
    }

    const pace: PedagogyPlan["pace"] =
      challengeLevel === "gentle" || profile.learningSpeed === "slow"
        ? "slow"
        : challengeLevel === "advanced"
          ? "brisk"
          : "normal";

    const emotion: PedagogyPlan["emotion"] =
      challengeLevel === "gentle"
        ? "patient"
        : challengeLevel === "advanced"
          ? "energetic"
          : "encouraging";

    return {
      strategy,
      challengeLevel,
      pace,
      emotion,
      rationale: `strategy=${strategy}; challenge=${challengeLevel}; pace=${pace}; weak=${memory.weakConcepts.slice(0, 3).join(",") || "none"}`,
    };
  }
}
