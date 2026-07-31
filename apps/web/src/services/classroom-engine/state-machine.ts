import type { LessonPhase, OrchestratorDecision, TeachingMove } from "./types";

/** Canonical order — never skip, never reverse (unless student explicitly asks). */
export const LESSON_PHASE_ORDER: LessonPhase[] = [
  "greeting",
  "intent_analysis",
  "knowledge_estimation",
  "learning_objective",
  "concept_explanation",
  "whiteboard_visualization",
  "worked_example",
  "guided_practice",
  "discussion",
  "understanding_check",
  "correction",
  "mini_quiz",
  "summary",
  "homework",
  "next_lesson",
  "complete",
];

const MOVE_FOR_PHASE: Record<LessonPhase, TeachingMove> = {
  greeting: "greet",
  intent_analysis: "greet",
  knowledge_estimation: "set_objective",
  learning_objective: "set_objective",
  concept_explanation: "explain",
  whiteboard_visualization: "draw",
  worked_example: "example",
  guided_practice: "practice",
  discussion: "discuss",
  understanding_check: "ask_check",
  correction: "correct",
  mini_quiz: "quiz",
  summary: "summarize",
  homework: "assign_homework",
  next_lesson: "recommend_next",
  complete: "recommend_next",
};

export function nextPhase(phase: LessonPhase): LessonPhase {
  const idx = LESSON_PHASE_ORDER.indexOf(phase);
  if (idx < 0) return "greeting";
  return LESSON_PHASE_ORDER[Math.min(idx + 1, LESSON_PHASE_ORDER.length - 1)]!;
}

export function decideMove(input: {
  phase: LessonPhase;
  awaitingAnswer: boolean;
  answerCorrect: boolean | null;
  studentSpoke: boolean;
  silence: boolean;
  hasExplained: boolean;
  hasDrawn: boolean;
  hasExample: boolean;
  hasPracticed: boolean;
  quizResolved: number;
}): OrchestratorDecision {
  // Student answer to a pending check — never invent a new topic.
  if (input.awaitingAnswer && input.studentSpoke && !input.silence) {
    if (input.answerCorrect === false) {
      return {
        phase: "correction",
        move: "correct",
        allowAsk: true,
        requireBoard: true,
        requireExample: true,
        reason: "Wrong answer — correct misconception, then re-ask.",
      };
    }
    if (input.answerCorrect === true) {
      // After a correct check, advance past understanding_check/correction.
      const advanced =
        input.phase === "understanding_check" || input.phase === "correction"
          ? "mini_quiz"
          : input.phase === "mini_quiz"
            ? input.quizResolved + 1 >= 2
              ? "summary"
              : "mini_quiz"
            : nextPhase(input.phase);
      return {
        phase: advanced,
        move: MOVE_FOR_PHASE[advanced],
        allowAsk: advanced === "mini_quiz" || advanced === "understanding_check",
        requireBoard: advanced !== "summary" && advanced !== "homework",
        requireExample: false,
        reason: "Correct answer — advance lesson flow.",
      };
    }
    return {
      phase: input.phase,
      move: "react_to_student",
      allowAsk: input.phase === "understanding_check" || input.phase === "mini_quiz",
      requireBoard: true,
      requireExample: false,
      reason: "Student spoke during pending check — evaluate.",
    };
  }

  if (input.silence && input.awaitingAnswer) {
    return {
      phase: input.phase,
      move: "wait_silence",
      allowAsk: true,
      requireBoard: false,
      requireExample: false,
      reason: "Silence during check — re-ask gently.",
    };
  }

  // Free student interrupt during teaching — answer then stay on phase.
  if (input.studentSpoke && !input.awaitingAnswer) {
    return {
      phase: input.phase,
      move: "react_to_student",
      allowAsk: false,
      requireBoard: true,
      requireExample: false,
      reason: "Student interrupted — respond, then continue teaching.",
    };
  }

  // Hard gates: never ask before teaching stack is done.
  let phase = input.phase;
  if (
    phase === "understanding_check" &&
    !(input.hasExplained && input.hasDrawn && input.hasExample && input.hasPracticed)
  ) {
    if (!input.hasExplained) phase = "concept_explanation";
    else if (!input.hasDrawn) phase = "whiteboard_visualization";
    else if (!input.hasExample) phase = "worked_example";
    else phase = "guided_practice";
  }

  const move = MOVE_FOR_PHASE[phase];
  return {
    phase,
    move,
    allowAsk: move === "ask_check" || move === "quiz",
    requireBoard:
      move === "explain" ||
      move === "draw" ||
      move === "example" ||
      move === "practice" ||
      move === "set_objective" ||
      move === "correct",
    requireExample: move === "example" || move === "correct",
    reason: `Orchestrator advance: ${phase} → ${move}`,
  };
}

export function advanceAfterBeat(
  phase: LessonPhase,
  move: TeachingMove,
  flags: {
    awaitingAnswer: boolean;
    answerCorrect: boolean | null;
    quizResolved: number;
    sessionComplete: boolean;
  }
): LessonPhase {
  if (flags.sessionComplete) return "complete";
  if (flags.awaitingAnswer) return phase; // stay until answered
  if (move === "correct") return "understanding_check";
  if (move === "quiz" && flags.quizResolved < 2) return "mini_quiz";
  if (move === "ask_check") return "understanding_check";
  // Opening collapses intent+knowledge into a fast path after greeting.
  if (phase === "greeting") return "learning_objective";
  if (phase === "intent_analysis" || phase === "knowledge_estimation") {
    return "learning_objective";
  }
  if (phase === "discussion") return "understanding_check";
  return nextPhase(phase);
}
