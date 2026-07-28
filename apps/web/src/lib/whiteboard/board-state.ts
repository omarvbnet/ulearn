import { smoothStrokePoints } from "./smoothing";
import type {
  StrokePoint,
  UbrdEvent,
  WhiteboardThemeId,
  WhiteboardTool,
} from "./types";

export type BoardStroke = {
  id: string;
  pageId: string;
  tool: WhiteboardTool | string;
  color: string;
  opacity: number;
  width: number;
  points: StrokePoint[];
};

export type BoardText = {
  id: string;
  pageId: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
};

export type BoardShape = {
  id: string;
  pageId: string;
  kind: "rect" | "circle" | "line" | "arrow" | string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
};

export type BoardPage = {
  id: string;
  kind: "blank" | "pdf";
  pdfAssetId?: string;
  pdfPage?: number;
  pdfZoom?: number;
  strokes: BoardStroke[];
  texts: BoardText[];
  shapes: BoardShape[];
};

export type BoardLaser = {
  pageId: string;
  x: number;
  y: number;
  visible: boolean;
};

/** Deterministic board state rebuilt by applying timestamped events. */
export class BoardState {
  theme: WhiteboardThemeId = "WHITE";
  pages: BoardPage[] = [];
  currentPageId: string | null = null;
  tool: WhiteboardTool = "pen";
  color = "#111827";
  opacity = 1;
  laser: BoardLaser | null = null;
  /** Bumps on every applied event — drives efficient painter invalidation. */
  revision = 0;
  private undoStack: UbrdEvent[][] = [];
  private openStrokes = new Map<string, BoardStroke>();

  /** In-progress strokes (for progressive playback). */
  getOpenStrokes(): BoardStroke[] {
    return Array.from(this.openStrokes.values());
  }

  constructor() {
    this.addBlankPage("page_0");
  }

  get currentPage(): BoardPage | null {
    return this.pages.find((p) => p.id === this.currentPageId) ?? this.pages[0] ?? null;
  }

  reset() {
    this.theme = "WHITE";
    this.pages = [];
    this.currentPageId = null;
    this.tool = "pen";
    this.color = "#111827";
    this.opacity = 1;
    this.laser = null;
    this.openStrokes.clear();
    this.revision = 0;
    this.addBlankPage("page_0");
  }

  addBlankPage(id: string, index?: number) {
    const page: BoardPage = {
      id,
      kind: "blank",
      strokes: [],
      texts: [],
      shapes: [],
    };
    if (index == null || index >= this.pages.length) this.pages.push(page);
    else this.pages.splice(index, 0, page);
    this.currentPageId = id;
    return page;
  }

  applyEvents(events: UbrdEvent[]) {
    for (const e of events) this.apply(e);
  }

  apply(e: UbrdEvent) {
    this.revision++;
    const p = e.payload;
    switch (e.type) {
      case "session_start":
        if (typeof p.theme === "string") this.theme = p.theme as WhiteboardThemeId;
        break;
      case "theme_change":
        if (typeof p.theme === "string") this.theme = p.theme as WhiteboardThemeId;
        break;
      case "tool_change":
        if (typeof p.tool === "string") this.tool = p.tool as WhiteboardTool;
        break;
      case "color_change":
        if (typeof p.color === "string") this.color = p.color;
        if (typeof p.opacity === "number") this.opacity = p.opacity;
        break;
      case "page_add": {
        const id = String(p.pageId);
        const page = this.addBlankPage(id, typeof p.index === "number" ? p.index : undefined);
        if (p.kind === "pdf") {
          page.kind = "pdf";
          page.pdfAssetId = typeof p.pdfAssetId === "string" ? p.pdfAssetId : undefined;
          page.pdfPage = typeof p.pdfPage === "number" ? p.pdfPage : 1;
        }
        break;
      }
      case "page_select":
        if (typeof p.pageId === "string") this.currentPageId = p.pageId;
        break;
      case "page_delete": {
        const id = String(p.pageId);
        this.pages = this.pages.filter((pg) => pg.id !== id);
        if (this.currentPageId === id) this.currentPageId = this.pages[0]?.id ?? null;
        break;
      }
      case "page_clear": {
        const page = this.pages.find((pg) => pg.id === p.pageId);
        if (page) {
          page.strokes = [];
          page.texts = [];
          page.shapes = [];
        }
        break;
      }
      case "page_duplicate": {
        const src = this.pages.find((pg) => pg.id === p.pageId);
        if (!src) break;
        const clone: BoardPage = {
          ...src,
          id: String(p.newPageId),
          strokes: src.strokes.map((s) => ({ ...s, id: `${s.id}_c`, points: s.points.map((pt) => ({ ...pt })) })),
          texts: src.texts.map((t) => ({ ...t, id: `${t.id}_c` })),
          shapes: src.shapes.map((s) => ({ ...s, id: `${s.id}_c` })),
        };
        const idx = typeof p.index === "number" ? p.index : this.pages.length;
        this.pages.splice(idx, 0, clone);
        this.currentPageId = clone.id;
        break;
      }
      case "stroke_begin": {
        const stroke: BoardStroke = {
          id: String(p.strokeId),
          pageId: String(p.pageId),
          tool: String(p.tool) as WhiteboardTool,
          color: String(p.color ?? this.color),
          opacity: typeof p.opacity === "number" ? p.opacity : this.opacity,
          width: typeof p.width === "number" ? p.width : 3.5,
          points: [],
        };
        this.openStrokes.set(stroke.id, stroke);
        break;
      }
      case "stroke_point": {
        const stroke = this.openStrokes.get(String(p.strokeId));
        if (!stroke) break;
        stroke.points.push({
          x: Number(p.x),
          y: Number(p.y),
          p: typeof p.p === "number" ? p.p : undefined,
          t: typeof p.t === "number" ? p.t : undefined,
        });
        break;
      }
      case "stroke_end": {
        const id = String(p.strokeId);
        let stroke = this.openStrokes.get(id);
        if (Array.isArray(p.points)) {
          const points = (p.points as StrokePoint[]).map((pt) => ({ ...pt }));
          if (!stroke) {
            stroke = {
              id,
              pageId: String(p.pageId ?? this.currentPageId),
              tool: String(p.tool ?? this.tool) as WhiteboardTool,
              color: String(p.color ?? this.color),
              opacity: typeof p.opacity === "number" ? p.opacity : this.opacity,
              width: typeof p.width === "number" ? p.width : 3.5,
              points,
            };
          } else {
            stroke.points = points;
          }
        }
        if (!stroke) break;
        stroke.points = smoothStrokePoints(stroke.points);
        const page = this.pages.find((pg) => pg.id === stroke!.pageId) ?? this.currentPage;
        if (page) page.strokes.push(stroke);
        this.openStrokes.delete(id);
        break;
      }
      case "erase": {
        const page = this.pages.find((pg) => pg.id === p.pageId) ?? this.currentPage;
        if (!page) break;
        const ids = Array.isArray(p.strokeIds) ? (p.strokeIds as string[]) : [];
        if (ids.length) {
          const set = new Set(ids);
          page.strokes = page.strokes.filter((s) => !set.has(s.id));
        }
        break;
      }
      case "text_insert": {
        const page = this.pages.find((pg) => pg.id === p.pageId);
        if (!page) break;
        page.texts.push({
          id: String(p.textId),
          pageId: page.id,
          x: Number(p.x),
          y: Number(p.y),
          text: String(p.text ?? ""),
          color: String(p.color ?? this.color),
          fontSize: typeof p.fontSize === "number" ? p.fontSize : 28,
        });
        break;
      }
      case "text_update": {
        for (const page of this.pages) {
          const text = page.texts.find((t) => t.id === p.textId);
          if (!text) continue;
          if (typeof p.text === "string") text.text = p.text;
          if (typeof p.x === "number") text.x = p.x;
          if (typeof p.y === "number") text.y = p.y;
          if (typeof p.color === "string") text.color = p.color;
          if (typeof p.fontSize === "number") text.fontSize = p.fontSize;
        }
        break;
      }
      case "text_delete": {
        for (const page of this.pages) {
          page.texts = page.texts.filter((t) => t.id !== p.textId);
        }
        break;
      }
      case "shape_add": {
        const page = this.pages.find((pg) => pg.id === p.pageId);
        if (!page) break;
        const existing = page.shapes.find((s) => s.id === p.shapeId);
        if (existing) {
          if (typeof p.kind === "string") existing.kind = p.kind;
          if (typeof p.x1 === "number") existing.x1 = p.x1;
          if (typeof p.y1 === "number") existing.y1 = p.y1;
          if (typeof p.x2 === "number") existing.x2 = p.x2;
          if (typeof p.y2 === "number") existing.y2 = p.y2;
          if (typeof p.color === "string") existing.color = p.color;
          if (typeof p.width === "number") existing.width = p.width;
        } else {
          page.shapes.push({
            id: String(p.shapeId),
            pageId: page.id,
            kind: String(p.kind),
            x1: Number(p.x1),
            y1: Number(p.y1),
            x2: Number(p.x2),
            y2: Number(p.y2),
            color: String(p.color ?? this.color),
            width: typeof p.width === "number" ? p.width : 2,
          });
        }
        break;
      }
      case "shape_update": {
        for (const page of this.pages) {
          const shape = page.shapes.find((s) => s.id === p.shapeId);
          if (!shape) continue;
          for (const key of ["x1", "y1", "x2", "y2", "width"] as const) {
            if (typeof p[key] === "number") shape[key] = p[key] as number;
          }
          if (typeof p.color === "string") shape.color = p.color;
          if (typeof p.kind === "string") shape.kind = p.kind;
        }
        break;
      }
      case "shape_delete": {
        for (const page of this.pages) {
          page.shapes = page.shapes.filter((s) => s.id !== p.shapeId);
        }
        break;
      }
      case "laser_move":
        this.laser = {
          pageId: String(p.pageId ?? this.currentPageId),
          x: Number(p.x),
          y: Number(p.y),
          visible: p.visible !== false,
        };
        break;
      case "pdf_zoom": {
        const zoom = typeof p.zoom === "number" ? p.zoom : null;
        if (zoom == null) break;
        const assetId = typeof p.assetId === "string" ? p.assetId : null;
        for (const page of this.pages) {
          if (!assetId || page.pdfAssetId === assetId) {
            page.pdfZoom = Math.min(5, Math.max(0.5, zoom));
          }
        }
        break;
      }
      default:
        break;
    }
  }
}
