/** Shared UBRD schema types — keep in sync with Flutter domain models and docs/whiteboard/UBRD_SPEC.md */

export const UBRD_SCHEMA_VERSION = 1;
export const LOGICAL_BOARD_WIDTH = 1920;
export const LOGICAL_BOARD_HEIGHT = 1080;

export type WhiteboardThemeId = "WHITE" | "BLACK" | "GREEN";

export function parseWhiteboardTheme(v?: string | null): WhiteboardThemeId {
  switch ((v ?? "").toUpperCase()) {
    case "BLACK":
      return "BLACK";
    case "GREEN":
    case "CHALK":
    case "CHALKBOARD":
      return "GREEN";
    default:
      return "WHITE";
  }
}

export function nextWhiteboardTheme(theme: WhiteboardThemeId): WhiteboardThemeId {
  if (theme === "WHITE") return "GREEN";
  if (theme === "GREEN") return "BLACK";
  return "WHITE";
}

export function boardThemeColors(theme: WhiteboardThemeId) {
  switch (theme) {
    case "GREEN":
      return {
        surface: "#1A5C3A",
        surfaceDeep: "#0E3A24",
        chromeBg: "#0F2F1E",
        chromeFg: "#F1F5F9",
        defaultInk: "#F8FAFC",
        label: "Green board",
      };
    case "BLACK":
      return {
        surface: "#1A1D24",
        surfaceDeep: "#0B0D12",
        chromeBg: "#111827",
        chromeFg: "#F8FAFC",
        defaultInk: "#F8FAFC",
        label: "Blackboard",
      };
    case "WHITE":
    default:
      return {
        surface: "#F7F8FA",
        surfaceDeep: "#E8EDF4",
        chromeBg: "#EEF2F7",
        chromeFg: "#0F172A",
        defaultInk: "#111827",
        label: "Whiteboard",
      };
  }
}

export type WhiteboardTool =
  | "pen"
  | "pencil"
  | "highlighter"
  | "eraser"
  | "text"
  | "laser"
  | "rect"
  | "circle"
  | "line"
  | "arrow"
  | "select";

export type StrokePoint = {
  x: number;
  y: number;
  /** Pressure 0–1 when available */
  p?: number;
  /** Offset ms within stroke (optional) */
  t?: number;
};

export type UbrdEventType =
  | "session_start"
  | "session_end"
  | "theme_change"
  | "tool_change"
  | "color_change"
  | "stroke_begin"
  | "stroke_point"
  | "stroke_end"
  | "erase"
  | "text_insert"
  | "text_update"
  | "text_delete"
  | "shape_add"
  | "shape_update"
  | "shape_delete"
  | "laser_move"
  | "page_add"
  | "page_delete"
  | "page_duplicate"
  | "page_clear"
  | "page_select"
  | "pdf_open"
  | "pdf_close"
  | "pdf_switch"
  | "pdf_page"
  | "pdf_zoom"
  | "pdf_rotate"
  | "undo"
  | "redo"
  | "viewport"
  | "snapshot";

export type UbrdEvent = {
  id: string;
  /** Milliseconds from recording start */
  t: number;
  type: UbrdEventType;
  payload: Record<string, unknown>;
};

export type UbrdManifest = {
  schemaVersion: number;
  format: "ubrd";
  durationMs: number;
  theme: WhiteboardThemeId;
  pageCount: number;
  boardWidth: number;
  boardHeight: number;
  audioFile: string;
  audioCodec: string;
  createdAt: string;
  app: string;
  appVersion: string;
};

export type UbrdPdfAsset = {
  assetId: string;
  materialId?: string;
  fileKey?: string;
  fileUrl?: string;
  title: string;
  pageCount?: number;
};

export type UbrdAssets = {
  pdfs: UbrdPdfAsset[];
};

export type TimelineCue = {
  t: number;
  /** Line index into board.events */
  eventOffset: number;
  snapshot?: string | null;
};

export type UbrdTimeline = {
  cues: TimelineCue[];
  intervalMs: number;
};

export type ParsedUbrdPackage = {
  manifest: UbrdManifest;
  events: UbrdEvent[];
  timeline: UbrdTimeline;
  assets: UbrdAssets;
  audioBytes: Uint8Array;
  audioFileName: string;
  snapshots: Record<string, Uint8Array>;
};
