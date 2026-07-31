import type { ClassroomStreamEvent } from "./progressive-beat";

/** Build a text/event-stream Response that drives a classroom stream producer. */
export function classroomSseResponse(
  run: (emit: (event: ClassroomStreamEvent) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ClassroomStreamEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          /* client disconnected */
        }
      };
      try {
        emit({ type: "status", presence: "thinking", message: "Teacher is thinking…" });
        await run(emit);
      } catch (e) {
        emit({
          type: "error",
          message: e instanceof Error ? e.message : "Classroom stream failed",
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
