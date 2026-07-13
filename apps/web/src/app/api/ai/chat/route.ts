import { error, json, requireAuth } from "@/lib/api";
import { AiChatService } from "@/services/ai";
import { z } from "zod";

const attachmentSchema = z
  .object({
    fileName: z.string().min(1).max(240),
    mimeType: z.string().min(1).max(120),
    /** Inline base64 — keep small; large PDFs must use fileKey. */
    dataBase64: z.string().min(1).max(2_000_000).optional(),
    fileKey: z.string().min(1).max(500).optional(),
    fileUrl: z.string().min(1).max(2000).optional(),
  })
  .refine((a) => Boolean(a.dataBase64 || a.fileKey || a.fileUrl), {
    message: "fileKey, fileUrl, or dataBase64 required",
  });

const schema = z.object({
  question: z.string().max(4000).optional().default(""),
  conversationId: z.string().optional(),
  stageId: z.string().optional(),
  subjectId: z.string().optional(),
  subjectIds: z.array(z.string()).optional(),
  courseId: z.string().optional(),
  language: z.string().max(16).optional(),
  lesson: z.string().optional(),
  mode: z.enum(["chat", "practice_quiz", "edit", "explain_observe"]).optional(),
  documentIds: z.array(z.string()).max(20).optional(),
  /** Practice exam size: Basic=5, Intermediate=10, Advanced=20 */
  count: z.union([z.literal(5), z.literal(10), z.literal(20)]).optional(),
  attachments: z.array(attachmentSchema).max(8).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { question, attachments, ...rest } = parsed.data;
  const isPractice = rest.mode === "practice_quiz";
  const isExplainObserve = rest.mode === "explain_observe";
  if (
    !question.trim() &&
    !(attachments && attachments.length) &&
    !(isPractice && rest.documentIds?.length) &&
    !(isExplainObserve && rest.documentIds?.length)
  ) {
    return error("question or attachments required", 422, "VALIDATION");
  }

  try {
    const result = await AiChatService.chat({
      userId: auth.session.userId,
      question:
        question ||
        (isPractice
          ? "Generate a practice exam from my selected materials"
          : isExplainObserve
            ? "Explain and help me observe the selected material with shapes"
            : ""),
      attachments,
      ...rest,
    });
    return json(result);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Chat failed", 500, "AI_CHAT");
  }
}
