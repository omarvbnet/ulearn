import { error, requireAuth } from "@/lib/api";
import { ProfessorChatService } from "@/services/ai/professor";
import { z } from "zod";

const schema = z.object({
  question: z.string().min(1).max(8000),
  language: z.string().optional(),
  documentIds: z.array(z.string()).optional(),
  courseId: z.string().optional(),
  conversationId: z.string().optional(),
  stream: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  if (parsed.data.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };
        await ProfessorChatService.chatStream(
          {
            instructorId: auth.session!.userId,
            question: parsed.data.question,
            language: parsed.data.language,
            documentIds: parsed.data.documentIds,
            courseId: parsed.data.courseId,
            conversationId: parsed.data.conversationId,
          },
          send
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  try {
    const result = await ProfessorChatService.chat({
      instructorId: auth.session.userId,
      question: parsed.data.question,
      language: parsed.data.language,
      documentIds: parsed.data.documentIds,
      courseId: parsed.data.courseId,
      conversationId: parsed.data.conversationId,
    });
    return Response.json(result);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Chat failed", 500, "CHAT");
  }
}
