export type ClassroomEmotion =
  | "calm"
  | "encouraging"
  | "curious"
  | "patient"
  | "energetic";

export type ClassroomPace = "slow" | "normal" | "brisk";

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
  };
}
