import type {
  OrchestratorDecision,
  ReasoningOutput,
  ValidationResult,
} from "../types";

/**
 * Teaching Validator — every response must pass.
 * Fail → regenerate signal (orchestrator retries once).
 */
export class TeachingValidator {
  static validate(
    decision: OrchestratorDecision,
    output: ReasoningOutput
  ): ValidationResult {
    const reasons: string[] = [];

    if (!output.speak?.length) {
      reasons.push("No spoken teaching lines.");
    }
    if (decision.requireBoard && !output.boardInstructions?.length) {
      reasons.push("Board instructions missing for a visual teaching move.");
    }
    if (decision.requireExample && !output.exampleLabel && decision.move === "example") {
      reasons.push("Worked example missing exampleLabel.");
    }
    if (!decision.allowAsk && output.askStudent) {
      reasons.push("askStudent forbidden in this phase.");
    }
    if (decision.allowAsk && decision.move !== "correct" && !output.askStudent) {
      // soft — correct move may set ask after re-explain
      if (decision.move === "ask_check" || decision.move === "quiz") {
        reasons.push("Check/quiz move missing askStudent.");
      }
    }
    // Ban vague meta questions.
    if (
      output.askStudent &&
      /what did you understand|ماذا فهمت|شو فهمت|ne anladın/i.test(output.askStudent) &&
      decision.move !== "ask_check"
    ) {
      reasons.push("Vague understanding probe without educational purpose.");
    }
    if (
      output.speak.some((s) =>
        /\bpage\s*\d+|pages?\s+\d+|صفحة\s*\d+/i.test(s)
      )
    ) {
      reasons.push("Page-number narration is forbidden.");
    }

    if (!reasons.length) return { ok: true, reasons: [] };

    // Auto-repair mild issues.
    const repaired: ReasoningOutput = {
      ...output,
      askStudent: decision.allowAsk ? output.askStudent : null,
      boardInstructions:
        decision.requireBoard && !output.boardInstructions.length
          ? [
              {
                op: "write",
                text: (output.topic || "Key idea").slice(0, 28),
                color: "blue",
              },
              { op: "draw_circle", count: 1, color: "red" },
            ]
          : output.boardInstructions,
      speak: output.speak.length
        ? output.speak
        : [
            output.topic
              ? `Let’s focus on ${output.topic}.`
              : "Let’s continue this idea clearly on the board.",
          ],
    };

    const stillBad =
      (!repaired.speak.length && reasons.includes("No spoken teaching lines.")) ||
      (decision.allowAsk &&
        (decision.move === "ask_check" || decision.move === "quiz") &&
        !repaired.askStudent);

    return {
      ok: !stillBad,
      reasons,
      repaired,
    };
  }

  static wouldExperiencedTeacherApprove(
    decision: OrchestratorDecision,
    output: ReasoningOutput
  ): boolean {
    if (!output.speak.length) return false;
    if (decision.requireBoard && !output.boardInstructions.length) return false;
    if (!decision.allowAsk && output.askStudent) return false;
    return true;
  }
}
