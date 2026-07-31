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
      "",
      "SPOKEN VOICE STYLE (critical — this is live voice conversation, exactly like a premium voice assistant, but as a real teacher):",
      "- Write speak[] as natural SPOKEN sentences, the way a great teacher actually talks — flowing, warm, conversational rhythm. Never written-text style.",
      "- NEVER put lists, bullet symbols, numbering like '1)', formulas as raw symbols, markdown, or parentheses asides into speak[] — say it the way a human voice would say it.",
      "- If the student just spoke, FIRST acknowledge exactly what they said in a natural short reaction (e.g. a genuine 'nice thinking' / 'ah, good question'), THEN continue. React like a human, not a script.",
      "- Vary sentence length and rhythm: one short punchy line + one flowing line beats two identical-length lines. Use natural spoken connectors of the target language.",
      "- Add light natural pauses with commas and periods where a human would breathe — the voice engine renders them.",
      "- Make it feel personal and alive: rhetorical hooks ('now watch this…', 'here is the beautiful part…'), tiny bits of anticipation, honest enthusiasm for the subject.",
      "- Never repeat a sentence pattern you used in 'Recently said'. Never use filler like 'as an AI'.",
      "- Set emotion and pace honestly per beat (curious for hooks, encouraging after effort, patient when re-explaining, energetic for wins) — this directly drives the voice acting.",
      "",
      "ACTIVITIES — teach through doing, not lecturing: quick mental challenges, imagine-scenarios, count-with-me moments, predict-what-happens-next hooks, real-life mini stories. Every move should feel like an activity the student participates in, not a paragraph read aloud.",
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
        { temperature: 0.65, maxTokensExact: speech === "ar" ? 1300 : 1000 },
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
          // Early-stop ONLY when the JSON object is actually complete —
          // aborting on the bare "sessionComplete": key truncates the JSON
          // mid-stream and forces the fallback line on every beat.
          if (/"sessionComplete"\s*:\s*(?:true|false)/.test(full)) {
            const j = findJson(full);
            if (j) {
              try {
                JSON.parse(j);
                return true;
              } catch {
                /* JSON not complete yet — keep streaming */
              }
            }
          }
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
      return "MOVE greet: 1 warm, genuinely human hello — like a teacher happy to see THIS student walk in. askStudent=null. Minimal board.";
    case "set_objective":
      return "MOVE set_objective: hook curiosity first (one intriguing spoken line about what they're about to discover), then the learning goal in one natural sentence. boardInstructions MUST include write with the subject title. askStudent=null.";
    case "explain":
      return "MOVE explain: teach the concept as a spoken mini-moment — a hook ('now watch this…'), then the idea in plain living words with WHY it matters. 2 conversational lines. boardInstructions: write label + at least one draw_* that matches what you say. askStudent=null.";
    case "draw":
      return "MOVE draw: narrate the drawing live, like sketching in front of the student ('I'm drawing… see how…'). 1–2 lines. boardInstructions required (write + draw_*). askStudent=null.";
    case "example":
      return "MOVE example: one vivid real-life mini-story the student can picture (money, food, sports, phone…), spoken with real storytelling energy AND drawn (shapes for counts, arrows for process). Invite them into it ('imagine you…'). askStudent=null. Set exampleLabel.";
    case "practice":
      return "MOVE practice: an interactive activity — 'let's try one together', walk the steps out loud narrating your thinking, let the moment breathe like a real desk-side session. Board shows each step. askStudent=null.";
    case "discuss":
      return "MOVE discuss: a short thinking activity — a 'what do you think happens if…' style spoken hook that stimulates curiosity, then bridge onward. askStudent=null (formal checks come next phase).";
    case "ask_check":
      return "MOVE ask_check: ONE clear, purposeful understanding question spoken naturally (speak + askStudent) — it must reveal whether they truly got the idea, never a vague 'did you understand'. Light board OK.";
    case "correct":
      return "MOVE correct: answerCorrect=false. React kindly and specifically to their exact mistake first, then re-explain the SAME misconception with a simpler, fresh example + board, then ask the same check again (askStudent). Respect the mistake — no shame, real warmth.";
    case "quiz":
      return "MOVE quiz: one slightly harder quiz question delivered with a bit of game energy ('ready? here's a fun one…') (askStudent + speak).";
    case "summarize":
      return "MOVE summarize: recap the 1–2 key points as a satisfying spoken landing ('so what did we discover today…'). askStudent=null.";
    case "assign_homework":
      return "MOVE assign_homework: optional short, motivating real-life task string or null, spoken like a fun challenge not an order. askStudent=null.";
    case "recommend_next":
      return "MOVE recommend_next: celebrate genuinely, then tease the next lesson with curiosity; set lessonName to next curriculum lesson OR sessionComplete=true if finished.";
    case "react_to_student":
      return "MOVE react_to_student: FIRST react naturally to exactly what they said (surprise, delight, empathy — like a human), answer it specifically, then flow back into teaching. If pending check, set answerCorrect true/false.";
    case "wait_silence":
      return "MOVE wait_silence: gently and warmly re-ask the pending question (speak + askStudent) — encourage, never pressure.";
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
    speak: out.speak.slice(0, 3),
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
