# U Learn Board Recording (`.ubrd`) Specification

**Schema version:** `1`  
**Extension:** `.ubrd`  
**Container:** ZIP (deflate), proprietary package for synchronized whiteboard lessons.

This format is the source of truth for Whiteboard Lesson Studio V1 and must remain compatible with future live classrooms (V2) that reuse the same event engine and player.

## Design principles

1. Drawings are **vector strokes**, never raster images as source of truth.
2. Audio and board events share **one timeline** (`t` = milliseconds from recording start).
3. PDF files are **referenced**, never duplicated inside the package.
4. Postgres stores **metadata only**; stroke points live only in `board.events`.

## Package layout

```
lesson.ubrd
├── manifest.json
├── board.events          # NDJSON — one event per line
├── timeline.json         # seek index
├── audio.opus | audio.webm
├── assets.json
└── snapshots/            # optional JPEG/PNG page thumbs
    ├── 00000.jpg
    └── …
```

### `manifest.json`

```json
{
  "schemaVersion": 1,
  "format": "ubrd",
  "durationMs": 125000,
  "theme": "WHITE",
  "pageCount": 4,
  "boardWidth": 1920,
  "boardHeight": 1080,
  "audioFile": "audio.webm",
  "audioCodec": "opus",
  "createdAt": "2026-07-23T00:00:00.000Z",
  "app": "ulearn-whiteboard",
  "appVersion": "1"
}
```

- `theme`: `WHITE` | `BLACK`
- Logical board size is fixed; clients scale to the viewport (responsive).
- `audioCodec`: `opus` preferred. Web may produce `audio.webm` (Opus-in-WebM); Flutter may produce `audio.opus` or `audio.m4a`. Players must honor `audioFile` + `audioCodec`.

### `board.events` (NDJSON)

Each line is a JSON object:

```json
{ "id": "e_01H…", "t": 1250, "type": "stroke_end", "payload": { … } }
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique event id |
| `t` | number | ms from session start |
| `type` | string | Event type (below) |
| `payload` | object | Type-specific data |

### Event types (v1)

| Type | Payload (summary) |
|------|-------------------|
| `session_start` | `{ theme, boardWidth, boardHeight }` |
| `session_end` | `{ durationMs }` |
| `theme_change` | `{ theme }` |
| `tool_change` | `{ tool }` |
| `color_change` | `{ color, opacity? }` |
| `stroke_begin` | `{ strokeId, pageId, tool, color, opacity, width }` |
| `stroke_point` | `{ strokeId, x, y, p?, t }` — coords in logical board space 0…boardWidth/Height; `p` pressure 0–1 |
| `stroke_end` | `{ strokeId, points?: Point[] }` — optional compacted points array for efficiency |
| `erase` | `{ strokeIds: string[], pageId }` or `{ mode: "segment", … }` |
| `text_insert` | `{ textId, pageId, x, y, text, color, fontSize }` |
| `text_update` | `{ textId, text?, x?, y?, … }` |
| `text_delete` | `{ textId }` |
| `shape_add` | `{ shapeId, pageId, kind, x1, y1, x2, y2, color, width }` — kind: `rect`\|`circle`\|`line`\|`arrow` |
| `shape_update` | `{ shapeId, … }` |
| `shape_delete` | `{ shapeId }` |
| `laser_move` | `{ pageId, x, y, visible }` |
| `page_add` | `{ pageId, index, kind: "blank"\|"pdf", pdfAssetId?, pdfPage? }` |
| `page_delete` | `{ pageId }` |
| `page_duplicate` | `{ pageId, newPageId, index }` |
| `page_clear` | `{ pageId }` |
| `page_select` | `{ pageId }` |
| `pdf_open` | `{ assetId, title }` |
| `pdf_close` | `{ assetId }` |
| `pdf_switch` | `{ assetId }` |
| `pdf_page` | `{ assetId, page }` |
| `pdf_zoom` | `{ assetId, zoom }` |
| `pdf_rotate` | `{ assetId, degrees }` |
| `undo` | `{}` |
| `redo` | `{}` |
| `viewport` | `{ pageId, panX, panY, zoom }` |
| `snapshot` | `{ pageId, file: "snapshots/00012.jpg", t }` |

**Tools:** `pen` | `pencil` | `highlighter` | `eraser` | `text` | `laser` | `rect` | `circle` | `line` | `arrow` | `select`

**Stroke compaction:** Writers MAY emit many `stroke_point` events live, then replace the span with a single `stroke_end` that includes the full `points` array when finalizing the package (players must accept both styles).

### `timeline.json`

Seek index for O(log n) playback:

```json
{
  "cues": [
    { "t": 0, "eventOffset": 0, "snapshot": null },
    { "t": 5000, "eventOffset": 412, "snapshot": "snapshots/00005.jpg" }
  ],
  "intervalMs": 5000
}
```

`eventOffset` is the byte offset (or line index — V1 uses **line index**) into `board.events`.

### `assets.json`

```json
{
  "pdfs": [
    {
      "assetId": "pdf_1",
      "materialId": "clx…",
      "fileKey": "teacher-course-pdfs/…/file.pdf",
      "title": "Physics.pdf",
      "pageCount": 24
    }
  ]
}
```

PDF bytes are fetched from R2 via existing material/signed URLs. Never embed PDF files in `.ubrd`.

## Edit & admin review (lesson updates)

Teachers may **reopen** a published whiteboard in Studio to continue recording, annotate at the playhead, and **trim/cut** timeline ranges. Publishing an edit on a live (`APPROVED`) course creates a `CourseLessonUpdateRequest` with:

- `whiteboardAssetId` / `previousWhiteboardAssetId`
- `editDiffJson`: dirty time ranges for admin review

```json
{
  "ranges": [
    { "id": "r1", "startMs": 12000, "endMs": 28000, "kind": "redraw" },
    { "id": "r2", "startMs": 61000, "endMs": 61000, "kind": "trim", "removedMs": 4500 }
  ],
  "previousDurationMs": 125000,
  "newDurationMs": 118000
}
```

Admins review **only those ranges** (before/after clips), not the full lesson. Approving applies the new `whiteboardAssetId` to the live `CourseLesson`.

`editDiffJson` lives on the update request (Postgres), not inside the `.ubrd` package. The published package remains a full self-contained `.ubrd`.

## Recording contract

From **Start Recording** until **Stop Recording**, one session clock stamps every mic sample and every board interaction. Finalizing builds the zip and uploads once to R2.

## Playback contract

1. Download/cache `.ubrd`, unzip in memory or temp.
2. Start audio at `t=0`.
3. Apply events with `t <= playhead`, using timeline cues + optional snapshots for seek.
4. Students are view-only.

## V2 live classrooms

Realtime transport emits the same event types. Recorded sessions still finalize to `.ubrd`. Player and DB schema stay unchanged.

## Coordinate system

- Origin: top-left of the logical board.
- All stroke/shape/text coordinates are in logical pixels (`boardWidth` × `boardHeight`).
- Clients scale uniformly (`scale = min(viewW/boardW, viewH/boardH)`) and letterbox. UI chrome scales with viewport independently.
