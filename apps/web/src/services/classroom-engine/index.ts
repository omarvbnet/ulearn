/**
 * U Learn AI Classroom Engine v3.0
 * World-class educational platform — not a chatbot.
 *
 * Student → AI Gateway → Teaching Orchestrator → (Planner / Memory /
 * Knowledge / Pedagogy / Strategy) → DeepSeek Reasoning → Validator →
 * Whiteboard Engine → Voice Engine → Analytics → Recommendation → Student
 */
export { ClassroomGateway } from "./gateway";
export { TeachingOrchestrator } from "./orchestrator";
export { classroomEngineSse } from "./sse";
export * from "./types";
export { LESSON_PHASE_ORDER } from "./state-machine";
