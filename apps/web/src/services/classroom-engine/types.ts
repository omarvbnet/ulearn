/**
 * U Learn AI Classroom Engine v3.0 — shared contracts.
 * DeepSeek never owns lesson flow; the Orchestrator does.
 */

export type ClassroomLang = "ar" | "en" | "tr" | "ku";
export type SpeechLang = "ar" | "en" | "tr";

/** Strict lesson state machine — never skip, never reorder (unless student asks). */
export type LessonPhase =
  | "greeting"
  | "intent_analysis"
  | "knowledge_estimation"
  | "learning_objective"
  | "concept_explanation"
  | "whiteboard_visualization"
  | "worked_example"
  | "guided_practice"
  | "discussion"
  | "understanding_check"
  | "correction"
  | "mini_quiz"
  | "summary"
  | "homework"
  | "next_lesson"
  | "complete";

/** Orchestrator-decided teaching moves — DeepSeek only reasons for the move. */
export type TeachingMove =
  | "greet"
  | "set_objective"
  | "explain"
  | "draw"
  | "example"
  | "practice"
  | "discuss"
  | "ask_check"
  | "correct"
  | "quiz"
  | "summarize"
  | "assign_homework"
  | "recommend_next"
  | "react_to_student"
  | "wait_silence";

export type TeachingStrategy =
  | "direct_instruction"
  | "worked_example"
  | "socratic_guide"
  | "story_analogy"
  | "comparison"
  | "scaffolded_practice"
  | "remediation"
  | "challenge";

export type Emotion =
  | "calm"
  | "encouraging"
  | "curious"
  | "patient"
  | "energetic"
  | "confused"
  | "frustrated";

export type WhiteboardOp =
  | "clear"
  | "write"
  | "draw_circle"
  | "draw_rectangle"
  | "draw_line"
  | "draw_arrow"
  | "circle"
  | "highlight"
  | "underline"
  | "point"
  | "erase"
  | "animate";

export type BoardInstruction = {
  op: WhiteboardOp;
  text?: string;
  color?: string;
  count?: number;
  note?: string;
};

export type ClassroomBoardAction = {
  time?: number;
  action: string;
  parameters?: Record<string, unknown>;
};

export type StudentProfileSnapshot = {
  userId: string;
  name: string | null;
  age: number | null;
  grade: string | number | null;
  stageName: string | null;
  countryCode: string | null;
  provinceName: string | null;
  preferredLanguage: ClassroomLang;
  preferredAccent: string | null;
  preferredStyle: string | null;
  learningSpeed: "slow" | "normal" | "fast";
};

export type StudentMemorySnapshot = {
  completedLessons: string[];
  masteredConcepts: string[];
  weakConcepts: string[];
  mistakes: string[];
  interests: string[];
  discussionNotes: string[];
  homework: string[];
  quizHistory: string[];
  preferenceBlurb: string;
};

export type KnowledgeChunk = {
  text: string;
  documentName: string;
  page: number | null;
  score?: number;
};

export type PedagogyPlan = {
  strategy: TeachingStrategy;
  challengeLevel: "gentle" | "standard" | "advanced";
  pace: "slow" | "normal" | "brisk";
  emotion: Emotion;
  rationale: string;
};

export type LessonPlan = {
  lessonName: string;
  objective: string;
  conceptOutline: string[];
  curriculumOutline: string[];
  documentIds: string[];
  materialNames: string[];
};

export type OrchestratorDecision = {
  phase: LessonPhase;
  move: TeachingMove;
  allowAsk: boolean;
  requireBoard: boolean;
  requireExample: boolean;
  reason: string;
};

export type ReasoningRequest = {
  move: TeachingMove;
  phase: LessonPhase;
  strategy: TeachingStrategy;
  speechLanguage: SpeechLang;
  uiLanguage: ClassroomLang;
  countryCode: string | null;
  provinceName: string | null;
  lesson: LessonPlan;
  memory: StudentMemorySnapshot;
  knowledge: KnowledgeChunk[];
  pedagogy: PedagogyPlan;
  studentTranscript?: string | null;
  pendingQuestion?: string | null;
  recentSpeak: string[];
  boardSummary: string[];
};

export type ReasoningOutput = {
  speak: string[];
  boardInstructions: BoardInstruction[];
  askStudent: string | null;
  answerCorrect: boolean | null;
  emotion: Emotion;
  pace: "slow" | "normal" | "brisk";
  lessonName: string | null;
  homework: string | null;
  sessionComplete: boolean;
  topic: string | null;
  exampleLabel: string | null;
};

export type ValidationResult = {
  ok: boolean;
  reasons: string[];
  repaired?: ReasoningOutput;
};

export type EngineSessionState = {
  version: 3;
  phase: LessonPhase;
  lessonName: string | null;
  objective: string | null;
  currentTopic: string | null;
  currentExample: string | null;
  boardSummary: string[];
  spokenHistory: string[];
  studentUtterances: string[];
  mistakes: string[];
  pendingQuestion: string | null;
  awaitingAnswer: boolean;
  pendingAttempts: number;
  quizResolved: number;
  hasExplained: boolean;
  hasDrawn: boolean;
  hasExample: boolean;
  hasPracticed: boolean;
  understanding: number;
  confidence: number;
  attention: number;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  strategyHistory: TeachingStrategy[];
  pedagogy: PedagogyPlan | null;
  lessonPlan: LessonPlan | null;
  memory: StudentMemorySnapshot;
  boardCursorY: number;
  speechLanguage: SpeechLang;
  uiLanguage: ClassroomLang;
  countryCode: string | null;
  provinceName: string | null;
};

export type PublicSession = {
  id: string;
  status: "LIVE" | "PAUSED" | "ENDED";
  locale: string;
  countryCode: string | null;
  provinceName: string | null;
  documentIds: string[];
  materialNames: string[];
  curriculumOutline: string[];
  beatIndex: number;
  speechLocale: string;
  accent: string;
  state: {
    currentLessonName: string | null;
    currentTopic: string | null;
    emotionalState: Emotion;
    understanding: number;
    confidence: number;
    lastAskStudent: string | null;
    awaitingCorrectAnswer: boolean;
    pendingQuestion: string | null;
    lessonStage: string;
    currentWhiteboardStep: string | null;
    currentExample: string | null;
    currentPractice: string | null;
    currentQuiz: string | null;
    currentSummary: string | null;
  };
};

export type EngineBeat = {
  speak: string[];
  board: ClassroomBoardAction[];
  askStudent: string | null;
  waitForStudentMs: number;
  emotion: Emotion;
  pace: "slow" | "normal" | "brisk";
  lessonName: string | null;
  homework: string | null;
  sessionComplete: boolean;
  answerCorrect: boolean | null;
  teachingStrategy: TeachingStrategy;
  stageComplete: boolean;
};

export type StreamEvent =
  | { type: "status"; presence: string; message?: string }
  | { type: "session"; session: PublicSession }
  | { type: "speak"; index: number; text: string; emotion?: string; pace?: string }
  | { type: "board"; actions: ClassroomBoardAction[] }
  | {
      type: "complete";
      beat: EngineBeat;
      session: PublicSession;
    }
  | { type: "needs_materials"; materials: unknown[]; pendingQuestion?: string }
  | { type: "error"; message: string };

export type Emit = (event: StreamEvent) => void;

export function emptyEngineState(
  uiLanguage: ClassroomLang,
  speechLanguage: SpeechLang,
  countryCode: string | null,
  provinceName: string | null
): EngineSessionState {
  return {
    version: 3,
    phase: "greeting",
    lessonName: null,
    objective: null,
    currentTopic: null,
    currentExample: null,
    boardSummary: [],
    spokenHistory: [],
    studentUtterances: [],
    mistakes: [],
    pendingQuestion: null,
    awaitingAnswer: false,
    pendingAttempts: 0,
    quizResolved: 0,
    hasExplained: false,
    hasDrawn: false,
    hasExample: false,
    hasPracticed: false,
    understanding: 0.5,
    confidence: 0.5,
    attention: 0.7,
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    strategyHistory: [],
    pedagogy: null,
    lessonPlan: null,
    memory: {
      completedLessons: [],
      masteredConcepts: [],
      weakConcepts: [],
      mistakes: [],
      interests: [],
      discussionNotes: [],
      homework: [],
      quizHistory: [],
      preferenceBlurb: "",
    },
    boardCursorY: 160,
    speechLanguage,
    uiLanguage,
    countryCode,
    provinceName,
  };
}
