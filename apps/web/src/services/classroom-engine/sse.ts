import type { StreamEvent } from "./types";

/** SSE response for Classroom Engine v3. */
export function classroomEngineSse(
  run: (emit: (event: StreamEvent) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          /* disconnected */
        }
      };
      try {
        emit({
          type: "status",
          presence: "thinking",
          message: "Teacher is preparing…",
        });
        await run(emit);
      } catch (e) {
        emit({
          type: "error",
          message: e instanceof Error ? e.message : "Classroom engine failed",
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
