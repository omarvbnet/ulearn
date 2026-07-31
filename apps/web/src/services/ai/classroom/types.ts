export type ClassroomEmotion =
  | "calm"
  | "encouraging"
  | "curious"
  | "patient"
  | "energetic"
  | "frustrated"
  | "confused";

export type ClassroomPace = "slow" | "normal" | "brisk";

/** How hard the teacher should be pushing the student right now. Derived
 *  deterministically from confidence/understanding/answer streaks — see
 *  mergeState — and fed back into the prompt so the teacher visibly eases
 *  up or leans in instead of teaching every student at the same level. */
export type ClassroomChallengeLevel = "gentle" | "standard" | "advanced";

/** The pedagogical move used to teach the CURRENT beat. Tracked in
 *  strategyHistory so the teacher is instructed to never repeat the same
 *  move twice in a row — this is what keeps the lesson feeling like a real
 *  teacher varying their approach instead of a scripted loop. */
export type ClassroomTeachingStrategy =
  | "example"
  | "story"
  | "comparison"
  | "challenge_question"
  | "socratic_question"
  | "recap";

/** Deterministic lesson-flow state machine (see LESSON STAGE DIRECTIVE in
 *  classroom-prompts). Scoped to ONE curriculum lesson at a time — a full
 *  pass through every stage teaches exactly one lesson, then recommend_next
 *  loops back to "objective" for the next lesson. The AI is NEVER allowed
 *  to skip, reorder, or self-report its way past a stage; every transition
 *  is verified with concrete evidence in advanceLessonStage. */
export type ClassroomLessonStage =
  | "greeting"
  | "objective"
  | "explain"
  | "guided_practice"
  | "check_understanding"
  | "mini_quiz"
  | "summary"
  | "homework"
  | "recommend_next";

export type ClassroomBoardAction = {
  time?: number;
  action: string;
  parameters?: Record<string, unknown>;
};

export type ClassroomSessionState = {
  currentLessonName: string | null;
  currentTopic: string | null;
  boardSummary: string[];
  spokenHistory: string[];
  studentQuestions: string[];
  mistakes: string[];
  interests: string[];
  understanding: number; // 0–1
  attention: number;
  confidence: number;
  learningSpeed: "slow" | "normal" | "fast";
  emotionalState: ClassroomEmotion;
  teachingStyle: string;
  lastAskStudent: string | null;
  materialExcerpt: string;
  /** Vertical cursor for neat board stacking across beats */
  boardCursorY: number;
  /** Teacher asked a check question and waits for a correct spoken answer */
  awaitingCorrectAnswer: boolean;
  pendingQuestion: string | null;
  pendingAnswerHint: string | null;
  pendingAttempts: number;
  /** Consecutive teaching beats spent explaining the CURRENT idea without
   *  asking a check question yet. Resets when a check is asked or the topic
   *  changes — gates check questions until the idea has been taught deeply. */
  explainBeats: number;
  /** How hard to push the student right now — derived from confidence,
   *  understanding, and answer streaks (see mergeState), not just the
   *  model's self-report, so difficulty adaptation is always real. */
  challengeLevel: ClassroomChallengeLevel;
  /** Consecutive correct / wrong check answers — the deterministic signal
   *  challengeLevel and emotionalState escalation are derived from. */
  consecutiveCorrect: number;
  consecutiveWrong: number;
  /** Last few teaching strategies used, most recent last — lets the prompt
   *  forbid repeating the same pedagogical move two beats in a row. */
  strategyHistory: ClassroomTeachingStrategy[];
  /** LONG-TERM MEMORY (loaded once when the session opens from
   *  StudentAiMemory, kept in sync live as lessons finish / checks resolve):
   *  lessons already completed for THIS material — never re-taught — and
   *  concept-level mastery labels used to skip re-explaining what the
   *  student has already proven they know, and to flag what still needs
   *  quiet reinforcement or review. */
  materialCompletedLessons: string[];
  masteredTopics: string[];
  weakTopics: string[];
  /** Static student-preference blurb (weak/strong subjects, preferred style,
   *  learning pace, preferred language) computed ONCE from StudentAiMemory
   *  when the session opens and cached here for the rest of the session —
   *  this data barely changes mid-session, so every later beat/turn reuses
   *  it instead of re-querying the database every single beat. */
  studentPreferenceBlurb: string;
  /** Where the lesson-flow state machine currently is — see
   *  ClassroomLessonStage. Advanced deterministically, never trusted from
   *  the model's self-report alone. */
  lessonStage: ClassroomLessonStage;
  /** Beats spent in the CURRENT lessonStage — resets to 0 on every
   *  transition. Used both as a minimum-depth gate and a stall safety net. */
  stageBeats: number;
  /** Whether a concrete illustrated real-life example has actually been
   *  taught during the CURRENT lesson's explain stage — a hard requirement
   *  before advancing to guided practice, verified from the beat itself
   *  (teachingStrategy or an actual drawing), not the model's word alone. */
  hasGivenExample: boolean;
  /** Resolved mini-quiz rounds (asked AND answered, right or wrong so far)
   *  during the CURRENT lesson's mini_quiz stage — needs >=2 before summary. */
  quizProgress: number;
  /** Whether homework was actually assigned (not just visited) for the
   *  CURRENT lesson — informational only; assigning homework stays optional. */
  homeworkGiven: boolean;
};

export type ClassroomBeat = {
  speak: string[];
  board: ClassroomBoardAction[];
  askStudent?: string | null;
  waitForStudentMs?: number;
  emotion: ClassroomEmotion;
  pace: ClassroomPace;
  lessonName?: string | null;
  sessionComplete?: boolean;
  /** Whether the student's last answer was correct (react mode) */
  answerCorrect?: boolean | null;
  /** The pedagogical move used this beat (example/story/comparison/…). */
  teachingStrategy?: ClassroomTeachingStrategy | null;
  /** The model's own claim that everything the CURRENT lessonStage requires
   *  is done and it's ready to advance — a signal only, never trusted
   *  blindly (see advanceLessonStage in classroom-session.service). */
  stageComplete?: boolean;
  /** Optional homework task text. Only ever honored when lessonStage is
   *  "homework" — stripped everywhere else regardless of what the model sends. */
  homework?: string | null;
  memoryPatch?: Partial<ClassroomSessionState>;
};

export type ClassroomSessionPublic = {
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
  state: Pick<
    ClassroomSessionState,
    | "currentLessonName"
    | "currentTopic"
    | "emotionalState"
    | "understanding"
    | "confidence"
    | "lastAskStudent"
    | "awaitingCorrectAnswer"
    | "pendingQuestion"
  >;
};

export function emptyClassroomState(
  materialExcerpt = ""
): ClassroomSessionState {
  return {
    currentLessonName: null,
    currentTopic: null,
    boardSummary: [],
    spokenHistory: [],
    studentQuestions: [],
    mistakes: [],
    interests: [],
    understanding: 0.5,
    attention: 0.7,
    confidence: 0.5,
    learningSpeed: "normal",
    emotionalState: "calm",
    teachingStyle: "warm_expert",
    lastAskStudent: null,
    materialExcerpt,
    boardCursorY: 140,
    awaitingCorrectAnswer: false,
    pendingQuestion: null,
    pendingAnswerHint: null,
    pendingAttempts: 0,
    explainBeats: 0,
    challengeLevel: "standard",
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    strategyHistory: [],
    materialCompletedLessons: [],
    masteredTopics: [],
    weakTopics: [],
    studentPreferenceBlurb: "",
    lessonStage: "greeting",
    stageBeats: 0,
    hasGivenExample: false,
    quizProgress: 0,
    homeworkGiven: false,
  };
}
