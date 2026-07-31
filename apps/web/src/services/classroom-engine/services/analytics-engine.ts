import type { EngineSessionState, TeachingMove } from "../types";

/** Lightweight in-session analytics — fire-and-forget safe. */
export class AnalyticsEngine {
  static recordBeat(input: {
    sessionId: string;
    userId: string;
    move: TeachingMove;
    phase: string;
    understanding: number;
    latencyMs?: number;
  }) {
    // Structured log for ops / future warehouse — never block teaching.
    console.info(
      JSON.stringify({
        kind: "classroom_engine_v3_beat",
        ...input,
        at: new Date().toISOString(),
      })
    );
  }

  static snapshot(state: EngineSessionState) {
    return {
      phase: state.phase,
      understanding: state.understanding,
      confidence: state.confidence,
      attention: state.attention,
      quizResolved: state.quizResolved,
      consecutiveCorrect: state.consecutiveCorrect,
      consecutiveWrong: state.consecutiveWrong,
    };
  }
}
