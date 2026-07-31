import { AiProviderService } from "@/services/ai/ai-provider.service";
import {
  classroomLanguageLock,
  classroomSpeechLanguage,
} from "@/services/ai/voice-accent";
import type { ChatMessage } from "@/services/ai/types";
import type {
  BoardInstruction,
  Emotion,
  ReasoningOutput,
  ReasoningRequest,
  TeachingMove,
} from "../types";

/**
 * DeepSeek Reasoning Engine — reasoning only.
 * Never decides lesson flow, never draws, never orchestrates.
 */
export class ReasoningEngine {
  static async reason(
    req: ReasoningRequest,
    onPartial?: (partial: { speak?: string; index?: number }) => void,
    userId?: string
  ): Promise<ReasoningOutput> {
    const speech = classroomSpeechLanguage({
      language: req.uiLanguage,
      countryCode: req.countryCode,
      provinceName: req.provinceName,
    });
    const system = [
      classroomLanguageLock({
        language: req.uiLanguage,
        countryCode: req.countryCode,
        provinceName: req.provinceName,
      }),
      "",
      "You are the Reasoning Engine of U Learn Classroom Engine v3.",
      "You do NOT control the lesson. The Orchestrator already decided the teaching move.",
      `Your ONLY job: perform this move → ${req.move} (phase=${req.phase}).`,
      `Teaching strategy to use: ${req.strategy} (${req.pedagogy.rationale}).`,
      "Behave like a professional teacher with 25+ years of classroom experience.",
      "Maximize student understanding. Never sound like a chatbot.",
      "Never mention page numbers, PDF filenames, or cover teacher names.",
      "SOURCE MATERIAL may be another language — TRANSLATE into the LANGUAGE LOCK language.",
      "",
      "Return ONLY valid JSON:",
      '{"speak":["..."],"boardInstructions":[{"op":"write","text":"...","color":"blue"},{"op":"draw_circle","count":2,"color":"red"}],"askStudent":null,"answerCorrect":null,"emotion":"encouraging","pace":"normal","lessonName":null,"homework":null,"sessionComplete":false,"topic":"...","exampleLabel":null}',
      "",
      "boardInstructions ops: clear|write|draw_circle|draw_rectangle|draw_line|draw_arrow|circle|highlight|underline|point|erase|animate",
      "You never draw yourself — only emit boardInstructions for the Whiteboard Engine.",
      moveRules(req.move),
      "",
      `Lesson: ${req.lesson.lessonName}`,
      `Objective: ${req.lesson.objective}`,
      `Concepts: ${req.lesson.conceptOutline.join(" · ")}`,
      req.memory.masteredConcepts.length
        ? `Mastered (do not re-teach): ${req.memory.masteredConcepts.slice(-8).join(", ")}`
        : "",
      req.memory.weakConcepts.length
        ? `Weak (reinforce gently): ${req.memory.weakConcepts.slice(-6).join(", ")}`
        : "",
      req.recentSpeak.length
        ? `Recently said (do not repeat):\n- ${req.recentSpeak.slice(-4).join("\n- ")}`
        : "",
      req.pendingQuestion ? `Pending question: ${req.pendingQuestion}` : "",
      req.studentTranscript ? `Student said: ${req.studentTranscript}` : "",
      "KNOWLEDGE (subject-scoped):",
      ...req.knowledge.slice(0, 5).map(
        (k, i) => `[${i + 1}] ${k.documentName}${k.page ? ` p.${k.page}` : ""}\n${k.text}`
      ),
    ]
      .filter(Boolean)
      .join("\n");

    const user = [
      classroomLanguageLock({
        language: req.uiLanguage,
        countryCode: req.countryCode,
        provinceName: req.provinceName,
      }),
      "",
      `Execute teaching move "${req.move}" now. JSON only. Language=${speech}.`,
    ].join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    let text = "";
    try {
      let speakIdx = 0;
      const result = await AiProviderService.chatStream(
        "TEACHING_ASSISTANT",
        messages,
        userId,
        { temperature: 0.4, maxTokensExact: speech === "ar" ? 1200 : 900 },
        (_delta, full) => {
          text = full;
          // Progressive speak extraction for streaming UX.
          const m = full.match(/"speak"\s*:\s*\[\s*"((?:\\.|[^"\\])*)"/);
          if (m?.[1] && onPartial && speakIdx === 0) {
            const line = unescapeJson(m[1]);
            if (line) {
              onPartial({ speak: line, index: 0 });
              speakIdx = 1;
            }
          }
          if (/"sessionComplete"\s*:/.test(full) && findJson(full)) return true;
          return false;
        }
      );
      text = result.text || text;
    } catch {
      /* fallback below */
    }

    const parsed = parseReasoning(text);
    if (parsed) return sanitizeOutput(parsed, req.move, speech);

    return fallbackOutput(req, speech);
  }
}

function moveRules(move: TeachingMove): string {
  switch (move) {
    case "greet":
      return "MOVE greet: 1 warm hello line. askStudent=null. Minimal board (optional title later).";
    case "set_objective":
      return "MOVE set_objective: state today's learning goal in 1–2 lines. boardInstructions MUST include write with the subject title. askStudent=null.";
    case "explain":
      return "MOVE explain: 2 short lines defining the concept + why it matters. boardInstructions: write label + at least one draw_*. askStudent=null.";
    case "draw":
      return "MOVE draw: narrate what you draw (1–2 lines). boardInstructions required (write + draw_*). askStudent=null.";
    case "example":
      return "MOVE example: one concrete real-life example spoken + drawn (shapes for counts, arrows for process). askStudent=null. Set exampleLabel.";
    case "practice":
      return "MOVE practice: guided walkthrough 'let's try together' with board steps. askStudent=null.";
    case "discuss":
      return "MOVE discuss: brief engaging bridge to thinking. askStudent=null (checks come next phase).";
    case "ask_check":
      return "MOVE ask_check: ONE clear understanding question in speak + askStudent. Educational purpose only. Light board OK.";
    case "correct":
      return "MOVE correct: answerCorrect=false. Re-explain the SAME misconception with a simpler example + board, then ask the same check again (askStudent).";
    case "quiz":
      return "MOVE quiz: one slightly harder quiz question (askStudent + speak).";
    case "summarize":
      return "MOVE summarize: 1–2 key points. askStudent=null.";
    case "assign_homework":
      return "MOVE assign_homework: optional short homework string or null. askStudent=null.";
    case "recommend_next":
      return "MOVE recommend_next: congratulate; set lessonName to next curriculum lesson OR sessionComplete=true if finished.";
    case "react_to_student":
      return "MOVE react_to_student: answer exactly what they said, then continue teaching. If pending check, set answerCorrect true/false.";
    case "wait_silence":
      return "MOVE wait_silence: gently re-ask pending question (speak + askStudent).";
    default:
      return "Follow the move precisely.";
  }
}

function unescapeJson(s: string) {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s.replace(/\\n/g, " ").trim();
  }
}

function findJson(raw: string): string | null {
  const t = raw.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return t.slice(start, end + 1);
}

function parseReasoning(raw: string): ReasoningOutput | null {
  const json = findJson(raw || "");
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const speak = Array.isArray(o.speak)
      ? o.speak.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 3)
      : [];
    const boardInstructions = Array.isArray(o.boardInstructions)
      ? (o.boardInstructions as BoardInstruction[]).slice(0, 6)
      : [];
    return {
      speak,
      boardInstructions,
      askStudent: o.askStudent ? String(o.askStudent) : null,
      answerCorrect:
        o.answerCorrect === true ? true : o.answerCorrect === false ? false : null,
      emotion: (String(o.emotion || "encouraging") as Emotion) || "encouraging",
      pace:
        o.pace === "slow" || o.pace === "brisk"
          ? o.pace
          : "normal",
      lessonName: o.lessonName ? String(o.lessonName) : null,
      homework: o.homework ? String(o.homework) : null,
      sessionComplete: Boolean(o.sessionComplete),
      topic: o.topic ? String(o.topic) : null,
      exampleLabel: o.exampleLabel ? String(o.exampleLabel) : null,
    };
  } catch {
    return null;
  }
}

function sanitizeOutput(
  out: ReasoningOutput,
  move: TeachingMove,
  _speech: string
): ReasoningOutput {
  const askAllowed =
    move === "ask_check" ||
    move === "quiz" ||
    move === "correct" ||
    move === "wait_silence";
  return {
    ...out,
    speak: out.speak.slice(0, 2),
    askStudent: askAllowed ? out.askStudent : null,
    homework: move === "assign_homework" ? out.homework : null,
    lessonName: move === "recommend_next" ? out.lessonName : null,
  };
}

function fallbackOutput(
  req: ReasoningRequest,
  speech: "ar" | "en" | "tr"
): ReasoningOutput {
  const topic =
    req.lesson.objective ||
    req.lesson.lessonName ||
    (speech === "ar" ? "فكرة الدرس" : speech === "tr" ? "Ders fikri" : "Key idea");
  const lines: Record<"ar" | "tr" | "en", string[]> = {
    ar: [`خلّينا نشرح ${topic} بوضوح على السبورة.`, "شوف الفكرة وياي خطوة خطوة."],
    tr: [`${topic} konusunu tahtada net anlatalım.`, "Adım adım birlikte gidelim."],
    en: [`Let’s explain ${topic} clearly on the board.`, "We’ll go step by step together."],
  };
  const ask: Record<"ar" | "tr" | "en", string> = {
    ar: `كيف تشرح ${topic} بكلماتك؟`,
    tr: `${topic} konusunu kendi cümlelerinle nasıl anlatırsın?`,
    en: `How would you explain ${topic} in your own words?`,
  };
  const needsAsk =
    req.move === "ask_check" ||
    req.move === "quiz" ||
    req.move === "wait_silence" ||
    req.move === "correct";
  return {
    speak: lines[speech],
    boardInstructions: [
      { op: "write", text: topic.slice(0, 28), color: "blue" },
      { op: "draw_circle", count: 1, color: "red" },
    ],
    askStudent: needsAsk ? ask[speech] : null,
    answerCorrect: null,
    emotion: req.pedagogy.emotion,
    pace: req.pedagogy.pace,
    lessonName: req.move === "recommend_next" ? req.lesson.curriculumOutline[1] || null : null,
    homework: null,
    sessionComplete: false,
    topic: topic.slice(0, 40),
    exampleLabel: req.move === "example" ? topic.slice(0, 40) : null,
  };
}
