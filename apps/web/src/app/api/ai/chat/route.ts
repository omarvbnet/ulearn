import { error, json, requireAuth } from "@/lib/api";
import { AiChatService } from "@/services/ai";
import { z } from "zod";

const schema = z.object({
  question: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
  stageId: z.string().optional(),
  subjectId: z.string().optional(),
  courseId: z.string().optional(),
  language: z.string().optional(),
  lesson: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = await AiChatService.chat({
      userId: auth.session.userId,
      ...parsed.data,
    });
    return json(result);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Chat failed", 500, "AI_CHAT");
  }
}
