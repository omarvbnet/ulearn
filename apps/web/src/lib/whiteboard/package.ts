import JSZip from "jszip";
import { EventEngine } from "./event-engine";
import {
  LOGICAL_BOARD_HEIGHT,
  LOGICAL_BOARD_WIDTH,
  UBRD_SCHEMA_VERSION,
  type ParsedUbrdPackage,
  type UbrdAssets,
  type UbrdManifest,
  type UbrdTimeline,
  type WhiteboardThemeId,
} from "./types";

export type BuildUbrdInput = {
  engine: EventEngine;
  audioBytes: Uint8Array;
  audioFileName?: string;
  audioCodec?: string;
  theme: WhiteboardThemeId;
  pageCount: number;
  durationMs: number;
  assets?: UbrdAssets;
  snapshots?: Record<string, Uint8Array>;
  boardWidth?: number;
  boardHeight?: number;
};

export async function buildUbrdPackage(input: BuildUbrdInput): Promise<Uint8Array> {
  const audioFile = input.audioFileName ?? "audio.webm";
  const manifest: UbrdManifest = {
    schemaVersion: UBRD_SCHEMA_VERSION,
    format: "ubrd",
    durationMs: input.durationMs,
    theme: input.theme,
    pageCount: input.pageCount,
    boardWidth: input.boardWidth ?? LOGICAL_BOARD_WIDTH,
    boardHeight: input.boardHeight ?? LOGICAL_BOARD_HEIGHT,
    audioFile,
    audioCodec: input.audioCodec ?? "opus",
    createdAt: new Date().toISOString(),
    app: "ulearn-whiteboard",
    appVersion: "1",
  };

  const timeline = input.engine.buildTimeline(5000, input.durationMs);
  const assets: UbrdAssets = input.assets ?? { pdfs: [] };

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("board.events", input.engine.toNdjson());
  zip.file("timeline.json", JSON.stringify(timeline));
  zip.file("assets.json", JSON.stringify(assets, null, 2));
  zip.file(audioFile, input.audioBytes);

  if (input.snapshots) {
    for (const [name, bytes] of Object.entries(input.snapshots)) {
      const path = name.startsWith("snapshots/") ? name : `snapshots/${name}`;
      zip.file(path, bytes);
    }
  }

  const out = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return out;
}

export async function parseUbrdPackage(bytes: ArrayBuffer | Uint8Array): Promise<ParsedUbrdPackage> {
  const zip = await JSZip.loadAsync(bytes);
  const manifestRaw = await zip.file("manifest.json")?.async("string");
  if (!manifestRaw) throw new Error("INVALID_PACKAGE_MANIFEST");
  const manifest = JSON.parse(manifestRaw) as UbrdManifest;

  const eventsRaw = (await zip.file("board.events")?.async("string")) ?? "";
  const events = EventEngine.parseNdjson(eventsRaw);

  const timelineRaw = (await zip.file("timeline.json")?.async("string")) ?? '{"cues":[],"intervalMs":5000}';
  const timeline = JSON.parse(timelineRaw) as UbrdTimeline;

  const assetsRaw = (await zip.file("assets.json")?.async("string")) ?? '{"pdfs":[]}';
  const assets = JSON.parse(assetsRaw) as UbrdAssets;

  const audioFileName = manifest.audioFile || "audio.webm";
  const audioEntry = zip.file(audioFileName) ?? zip.file("audio.opus") ?? zip.file("audio.webm") ?? zip.file("audio.m4a");
  if (!audioEntry) throw new Error("INVALID_PACKAGE_AUDIO");
  const audioBytes = await audioEntry.async("uint8array");

  const snapshots: Record<string, Uint8Array> = {};
  const folder = zip.folder("snapshots");
  if (folder) {
    const tasks: Promise<void>[] = [];
    folder.forEach((relativePath, file) => {
      if (file.dir) return;
      tasks.push(
        file.async("uint8array").then((data) => {
          snapshots[`snapshots/${relativePath}`] = data;
        })
      );
    });
    await Promise.all(tasks);
  }

  return {
    manifest,
    events,
    timeline,
    assets,
    audioBytes,
    audioFileName,
    snapshots,
  };
}
