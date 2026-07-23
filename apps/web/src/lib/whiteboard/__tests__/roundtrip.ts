import { buildUbrdPackage, parseUbrdPackage } from "@/lib/whiteboard/package";
import { EventEngine } from "@/lib/whiteboard/event-engine";
import { LOGICAL_BOARD_HEIGHT, LOGICAL_BOARD_WIDTH } from "@/lib/whiteboard/types";

/** Golden round-trip: build empty-ish package and parse back. */
export async function runUbrdRoundTripSmoke(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const engine = new EventEngine();
    const t0 = Date.now();
    engine.start(t0);
    // Force deterministic timestamps for the smoke test.
    (engine as unknown as { startedAt: number }).startedAt = t0;
    engine.push("session_start", {
      theme: "WHITE",
      boardWidth: LOGICAL_BOARD_WIDTH,
      boardHeight: LOGICAL_BOARD_HEIGHT,
    });
    engine.push("page_select", { pageId: "page_0" });
    engine.push("stroke_begin", {
      strokeId: "s1",
      pageId: "page_0",
      tool: "pen",
      color: "#111827",
      opacity: 1,
      width: 3.5,
    });
    engine.push("stroke_end", {
      strokeId: "s1",
      pageId: "page_0",
      points: [
        { x: 10, y: 10, p: 0.5 },
        { x: 40, y: 50, p: 0.8 },
        { x: 80, y: 20, p: 0.4 },
      ],
    });
    const durationMs = 2500;
    engine.push("session_end", { durationMs });
    (engine as unknown as { startedAt: number | null }).startedAt = null;

    const audio = new TextEncoder().encode("fake-opus-bytes-for-test");
    const bytes = await buildUbrdPackage({
      engine,
      audioBytes: audio,
      audioFileName: "audio.webm",
      audioCodec: "opus",
      theme: "WHITE",
      pageCount: 1,
      durationMs,
      assets: { pdfs: [{ assetId: "pdf_1", title: "Demo.pdf", fileKey: "teacher-course-pdfs/demo.pdf" }] },
    });

    const parsed = await parseUbrdPackage(bytes);
    if (parsed.manifest.format !== "ubrd") throw new Error("bad format");
    if (parsed.events.length < 4) throw new Error("missing events");
    if (parsed.assets.pdfs.length !== 1) throw new Error("missing assets");
    if (parsed.audioBytes.length === 0) throw new Error("missing audio");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
