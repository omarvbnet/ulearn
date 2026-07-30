import { error, json, requireAuth } from "@/lib/api";
import { AiChatService } from "@/services/ai";
import { z } from "zod";

const schema = z.object({
  question: z.string().min(1).max(1000),
  language: z.string().max(16).optional(),
  lessonTitle: z.string().max(200).optional(),
  pausedSpeechIndex: z.number().int().min(0).optional(),
  spokenSoFar: z.array(z.string().max(400)).max(12).optional(),
  documentIds: z.array(z.string().min(1).max(64)).max(12).optional(),
  curriculumOutline: z.array(z.string().max(200)).max(40).optional(),
  materialNames: z.array(z.string().max(200)).max(12).optional(),
});

/**
 * Live classroom interrupt — ChatGPT-like spoken answer + board drawings.
 * Answers any lesson inside the student's selected material(s).
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await AiChatService.classroomInterrupt({
      userId: auth.session.userId,
      ...parsed.data,
    });
    return json(result);
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Interrupt answer failed",
      500,
      "AI_TEACHER_INTERRUPT"
    );
  }
}
