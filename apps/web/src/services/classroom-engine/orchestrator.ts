import { advanceAfterBeat, decideMove } from "./state-machine";
import { PedagogicalEngine } from "./services/pedagogical-engine";
import { TeachingStrategyEngine } from "./services/teaching-strategy";
import { ReasoningEngine } from "./services/reasoning-engine";
import { TeachingValidator } from "./services/teaching-validator";
import { WhiteboardEngine } from "./services/whiteboard-engine";
import { VoiceEngine } from "./services/voice-engine";
import { AnalyticsEngine } from "./services/analytics-engine";
import { RecommendationEngine } from "./services/recommendation-engine";
import { KnowledgeRetrievalService } from "./services/knowledge-retrieval";
import type {
  Emit,
  EngineBeat,
  EngineSessionState,
  LessonPlan,
  PublicSession,
  ReasoningOutput,
  StudentProfileSnapshot,
} from "./types";

/**
 * Teaching Orchestrator — owns lesson flow.
 * DeepSeek only reasons for the move the orchestrator selects.
 */
export class TeachingOrchestrator {
  static async runBeat(input: {
    userId: string;
    sessionId: string;
    state: EngineSessionState;
    plan: LessonPlan;
    profile: StudentProfileSnapshot;
    mode: "open" | "next" | "react" | "silence";
    studentTranscript?: string;
    emit?: Emit;
    toPublic: (state: EngineSessionState, beatIndex: number) => PublicSession;
    beatIndex: number;
  }): Promise<{ beat: EngineBeat; state: EngineSessionState }> {
    const started = Date.now();
    const emit = input.emit;
    const studentSpoke =
      input.mode === "react" && Boolean(input.studentTranscript?.trim());
    const silence = input.mode === "silence";

    emit?.({
      type: "status",
      presence: "thinking",
      message: statusMsg(input.state.speechLanguage),
    });

    // Pedagogy + strategy BEFORE any DeepSeek call.
    const pedagogyBase = PedagogicalEngine.plan({
      profile: input.profile,
      memory: input.state.memory,
      consecutiveCorrect: input.state.consecutiveCorrect,
      consecutiveWrong: input.state.consecutiveWrong,
      understanding: input.state.understanding,
      confidence: input.state.confidence,
      phaseHint: input.state.phase,
    });
    const pedagogy = {
      ...pedagogyBase,
      strategy: TeachingStrategyEngine.next(
        pedagogyBase,
        input.state.strategyHistory
      ),
    };

    // Parallel: voice prep + optional fresh knowledge for topic.
    const topic =
      input.state.currentTopic || input.plan.objective || input.plan.lessonName;
    const [voice, knowledge] = await Promise.all([
      Promise.resolve(
        VoiceEngine.prepare({
          uiLanguage: input.state.uiLanguage,
          countryCode: input.state.countryCode,
          provinceName: input.state.provinceName,
          emotion: pedagogy.emotion,
          pace: pedagogy.pace,
        })
      ),
      topic && input.mode !== "open"
        ? KnowledgeRetrievalService.retrieveForTopic({
            userId: input.userId,
            documentIds: input.plan.documentIds,
            topic,
          }).catch(() => [])
        : Promise.resolve([]),
    ]);

    // Pre-decide answerCorrect for pending checks when student spoke —
    // first reasoning pass may set it; orchestrator still owns flow.
    let provisionalCorrect: boolean | null = null;
    if (input.state.awaitingAnswer && studentSpoke) {
      provisionalCorrect = null; // let reasoning judge
    }

    let decision = decideMove({
      phase: input.state.phase,
      awaitingAnswer: input.state.awaitingAnswer,
      answerCorrect: provisionalCorrect,
      studentSpoke,
      silence,
      hasExplained: input.state.hasExplained,
      hasDrawn: input.state.hasDrawn,
      hasExample: input.state.hasExample,
      hasPracticed: input.state.hasPracticed,
      quizResolved: input.state.quizResolved,
    });

    // Opening session: collapse greeting → objective in first beat for pace,
    // then teach. Orchestrator still owns this — not the model.
    if (input.mode === "open") {
      decision = {
        phase: "learning_objective",
        move: "set_objective",
        allowAsk: false,
        requireBoard: true,
        requireExample: false,
        reason: "Session open — greeting+objective owned by orchestrator.",
      };
    }

    const knowledgePack =
      knowledge.length > 0
        ? knowledge
        : [
            {
              text: input.plan.objective,
              documentName: input.plan.materialNames[0] || "material",
              page: null,
            },
          ];

    let output = await ReasoningEngine.reason(
      {
        move: decision.move,
        phase: decision.phase,
        strategy: pedagogy.strategy,
        speechLanguage: voice.speechLanguage,
        uiLanguage: input.state.uiLanguage,
        countryCode: input.state.countryCode,
        provinceName: input.state.provinceName,
        lesson: input.plan,
        memory: input.state.memory,
        knowledge: knowledgePack,
        pedagogy,
        studentTranscript: input.studentTranscript,
        pendingQuestion: input.state.pendingQuestion,
        recentSpeak: input.state.spokenHistory,
        boardSummary: input.state.boardSummary,
      },
      (partial) => {
        if (partial.speak != null && partial.index != null) {
          emit?.({
            type: "speak",
            index: partial.index,
            text: partial.speak,
            emotion: pedagogy.emotion,
            pace: pedagogy.pace,
          });
        }
      },
      input.userId
    );

    // If student answered a check, re-decide flow with model judgment.
    if (input.state.awaitingAnswer && studentSpoke) {
      decision = decideMove({
        phase: input.state.phase,
        awaitingAnswer: true,
        answerCorrect: output.answerCorrect,
        studentSpoke: true,
        silence: false,
        hasExplained: input.state.hasExplained,
        hasDrawn: input.state.hasDrawn,
        hasExample: input.state.hasExample,
        hasPracticed: input.state.hasPracticed,
        quizResolved: input.state.quizResolved,
      });
      if (decision.move === "correct" || decision.move === "quiz" || decision.move === "ask_check") {
        // Already have output; if wrong and move is correct, keep. If correct and advanced, may need second reason for next move — keep light for latency.
      }
    }

    let validation = TeachingValidator.validate(decision, output);
    if (!validation.ok && validation.repaired) {
      output = validation.repaired;
      validation = TeachingValidator.validate(decision, output);
    }
    if (!validation.ok) {
      // One regenerate attempt.
      output = await ReasoningEngine.reason(
        {
          move: decision.move,
          phase: decision.phase,
          strategy: pedagogy.strategy,
          speechLanguage: voice.speechLanguage,
          uiLanguage: input.state.uiLanguage,
          countryCode: input.state.countryCode,
          provinceName: input.state.provinceName,
          lesson: input.plan,
          memory: input.state.memory,
          knowledge: knowledgePack,
          pedagogy: { ...pedagogy, strategy: "direct_instruction" },
          studentTranscript: input.studentTranscript,
          pendingQuestion: input.state.pendingQuestion,
          recentSpeak: input.state.spokenHistory,
          boardSummary: input.state.boardSummary,
        },
        undefined,
        input.userId
      );
      const v2 = TeachingValidator.validate(decision, output);
      if (v2.repaired) output = v2.repaired;
    }

    // Recommendations for next_lesson move.
    if (decision.move === "recommend_next") {
      const rec = RecommendationEngine.nextLesson(input.plan, input.state);
      output = {
        ...output,
        lessonName: rec.lessonName,
        sessionComplete: rec.sessionComplete,
        speak: output.speak.length ? output.speak : [rec.message],
      };
    }

    const board = WhiteboardEngine.execute(output.boardInstructions, {
      speechLanguage: voice.speechLanguage,
      cursorY: input.state.boardCursorY,
    });
    let actions = board.actions;
    if (decision.requireBoard) {
      actions = WhiteboardEngine.ensureTeachingInk(
        actions,
        output.topic || input.plan.objective,
        voice.speechLanguage
      );
    }

    if (actions.length) {
      emit?.({ type: "board", actions });
    }

    // Emit any speak lines not already streamed.
    output.speak.forEach((line, i) => {
      emit?.({
        type: "speak",
        index: i,
        text: line,
        emotion: output.emotion,
        pace: output.pace,
      });
    });

    const ask = decision.allowAsk ? output.askStudent : null;
    const beat: EngineBeat = {
      speak: output.speak,
      board: actions,
      askStudent: ask,
      waitForStudentMs: ask ? 6000 : 0,
      emotion: output.emotion,
      pace: output.pace,
      lessonName: output.lessonName,
      homework: output.homework,
      sessionComplete: output.sessionComplete,
      answerCorrect: output.answerCorrect,
      teachingStrategy: pedagogy.strategy,
      stageComplete: !ask,
    };

    const nextState = applyState(input.state, {
      decision,
      output,
      beat,
      boardLabels: board.labels,
      nextCursorY: board.nextCursorY,
      pedagogy,
      plan: input.plan,
      studentTranscript: input.studentTranscript,
    });

    AnalyticsEngine.recordBeat({
      sessionId: input.sessionId,
      userId: input.userId,
      move: decision.move,
      phase: nextState.phase,
      understanding: nextState.understanding,
      latencyMs: Date.now() - started,
    });

    const publicSession = input.toPublic(nextState, input.beatIndex);
    emit?.({ type: "complete", beat, session: publicSession });
    emit?.({ type: "session", session: publicSession });

    return { beat, state: nextState };
  }
}

function applyState(
  prev: EngineSessionState,
  ctx: {
    decision: ReturnType<typeof decideMove>;
    output: ReasoningOutput;
    beat: EngineBeat;
    boardLabels: string[];
    nextCursorY: number;
    pedagogy: EngineSessionState["pedagogy"];
    plan: LessonPlan;
    studentTranscript?: string;
  }
): EngineSessionState {
  const next: EngineSessionState = {
    ...prev,
    pedagogy: ctx.pedagogy,
    lessonPlan: ctx.plan,
    boardCursorY: ctx.nextCursorY,
    spokenHistory: [...prev.spokenHistory, ...ctx.beat.speak].slice(-24),
    boardSummary: [...prev.boardSummary, ...ctx.boardLabels].slice(-16),
    strategyHistory: [
      ...prev.strategyHistory,
      ...(ctx.pedagogy ? [ctx.pedagogy.strategy] : []),
    ].slice(-8),
  };

  if (ctx.studentTranscript?.trim()) {
    next.studentUtterances = [
      ...next.studentUtterances,
      ctx.studentTranscript.trim(),
    ].slice(-16);
  }

  if (ctx.output.topic) next.currentTopic = ctx.output.topic.slice(0, 48);
  if (ctx.output.exampleLabel) {
    next.currentExample = ctx.output.exampleLabel;
    next.hasExample = true;
  }
  if (ctx.decision.move === "explain") next.hasExplained = true;
  if (ctx.decision.move === "draw" || ctx.boardLabels.length) next.hasDrawn = true;
  if (ctx.decision.move === "example") next.hasExample = true;
  if (ctx.decision.move === "practice") next.hasPracticed = true;
  if (ctx.decision.move === "set_objective") {
    next.objective = ctx.plan.objective;
    next.lessonName = ctx.plan.lessonName;
  }

  if (ctx.output.answerCorrect === true) {
    next.awaitingAnswer = false;
    next.pendingQuestion = null;
    next.pendingAttempts = 0;
    next.consecutiveCorrect += 1;
    next.consecutiveWrong = 0;
    next.understanding = Math.min(1, next.understanding + 0.08);
    next.confidence = Math.min(1, next.confidence + 0.08);
    if (prev.phase === "mini_quiz" || ctx.decision.phase === "mini_quiz") {
      next.quizResolved += 1;
    }
  } else if (ctx.output.answerCorrect === false) {
    next.consecutiveWrong += 1;
    next.consecutiveCorrect = 0;
    next.pendingAttempts += 1;
    next.understanding = Math.max(0.15, next.understanding - 0.06);
    next.mistakes = [
      ...next.mistakes,
      ctx.studentTranscript?.trim() || "incorrect",
    ].slice(-12);
  }

  if (ctx.beat.askStudent) {
    next.awaitingAnswer = true;
    next.pendingQuestion = ctx.beat.askStudent;
  } else if (ctx.output.answerCorrect === true) {
    next.awaitingAnswer = false;
  }

  next.phase = advanceAfterBeat(ctx.decision.phase, ctx.decision.move, {
    awaitingAnswer: next.awaitingAnswer,
    answerCorrect: ctx.output.answerCorrect,
    quizResolved: next.quizResolved,
    sessionComplete: ctx.beat.sessionComplete,
  });

  if (ctx.beat.lessonName) {
    next.lessonName = ctx.beat.lessonName;
    next.hasExplained = false;
    next.hasDrawn = false;
    next.hasExample = false;
    next.hasPracticed = false;
    next.quizResolved = 0;
    next.phase = "learning_objective";
  }

  if (ctx.beat.sessionComplete) next.phase = "complete";

  return next;
}

function statusMsg(lang: string) {
  if (lang === "ar") return "نكمل الدرس…";
  if (lang === "tr") return "Derse devam…";
  return "Continuing the lesson…";
}
