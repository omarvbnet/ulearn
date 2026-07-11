import { error, json, requireAuth } from "@/lib/api";
import { AiChatService } from "@/services/ai";
import { z } from "zod";

const attachmentSchema = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(120),
  dataBase64: z.string().min(1).max(6_000_000),
});

const schema = z.object({
  question: z.string().max(4000).optional().default(""),
  conversationId: z.string().optional(),
  stageId: z.string().optional(),
  subjectId: z.string().optional(),
  courseId: z.string().optional(),
  language: z.string().max(16).optional(),
  lesson: z.string().optional(),
  attachments: z.array(attachmentSchema).max(4).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { question, attachments, ...rest } = parsed.data;
  if (!question.trim() && !(attachments && attachments.length)) {
    return error("question or attachments required", 422, "VALIDATION");
  }

  try {
    const result = await AiChatService.chat({
      userId: auth.session.userId,
      question,
      attachments,
      ...rest,
    });
    return json(result);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Chat failed", 500, "AI_CHAT");
  }
}
