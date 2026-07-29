import { error, json, requireAuth } from "@/lib/api";
import { AiChatService } from "@/services/ai";
import { z } from "zod";

/**
 * Dedicated AI Teacher classroom endpoint.
 * Students must get a live board lesson — never a plain chat transcript.
 */
const schema = z.object({
  question: z.string().max(4000).optional().default(""),
  conversationId: z.string().optional(),
  stageId: z.string().optional(),
  subjectId: z.string().optional(),
  subjectIds: z.array(z.string()).optional(),
  language: z.string().max(16).optional(),
  documentIds: z.array(z.string()).max(20).optional(),
  chapterHeading: z.string().max(200).nullable().optional(),
  chunkFrom: z.number().int().min(0).nullable().optional(),
  chunkTo: z.number().int().min(0).nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const result = (await AiChatService.teacherClassroom({
      userId: auth.session.userId,
      ...parsed.data,
    })) as {
      needsMaterialSelection?: boolean;
      needsChapterSelection?: boolean;
      needsUpgrade?: boolean;
      aiTeacherLesson?: unknown;
      answer?: string;
      conversationId?: string | null;
      materials?: unknown;
      pendingMode?: string;
      pendingQuestion?: string;
      [key: string]: unknown;
    };

    if (
      !result.needsMaterialSelection &&
      !result.needsChapterSelection &&
      !result.needsUpgrade &&
      !result.aiTeacherLesson
    ) {
      return error(
        "Classroom lesson was not generated. Please try again.",
        500,
        "AI_TEACHER_NO_LESSON"
      );
    }

    return json({
      ...result,
      classroom: true,
    });
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "AI Teacher failed",
      500,
      "AI_TEACHER"
    );
  }
}
