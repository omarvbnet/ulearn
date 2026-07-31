import type { PedagogyPlan, TeachingStrategy } from "../types";

/** Teaching Strategy Engine — selects / rotates strategies. */
export class TeachingStrategyEngine {
  static next(
    pedagogy: PedagogyPlan,
    history: TeachingStrategy[]
  ): TeachingStrategy {
    const last = history[history.length - 1];
    if (pedagogy.strategy !== last) return pedagogy.strategy;
    const alts: TeachingStrategy[] = [
      "direct_instruction",
      "worked_example",
      "story_analogy",
      "comparison",
      "scaffolded_practice",
    ];
    return alts.find((s) => s !== last) || pedagogy.strategy;
  }
}
