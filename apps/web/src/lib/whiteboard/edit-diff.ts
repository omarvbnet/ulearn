/** Shared shape for whiteboard edit approval (stored on CourseLessonUpdateRequest.editDiffJson). */
export type WhiteboardEditRangeKind = "redraw" | "trim" | "audio" | "splice";

export type WhiteboardEditRange = {
  id: string;
  startMs: number;
  endMs: number;
  kind: WhiteboardEditRangeKind;
  /** Milliseconds removed by a trim/cut (join point may have startMs === endMs). */
  removedMs?: number;
  label?: string;
};

export type WhiteboardEditDiff = {
  ranges: WhiteboardEditRange[];
  previousDurationMs?: number;
  newDurationMs?: number;
};

export function normalizeEditDiff(raw: unknown): WhiteboardEditDiff | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rangesIn = Array.isArray(obj.ranges) ? obj.ranges : [];
  const ranges: WhiteboardEditRange[] = [];
  for (const r of rangesIn) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const startMs = Number(row.startMs);
    const endMs = Number(row.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const kind = (row.kind as WhiteboardEditRangeKind) || "redraw";
    ranges.push({
      id: String(row.id ?? `r_${ranges.length}`),
      startMs: Math.max(0, Math.round(startMs)),
      endMs: Math.max(0, Math.round(endMs)),
      kind,
      ...(typeof row.removedMs === "number" ? { removedMs: Math.round(row.removedMs) } : {}),
      ...(typeof row.label === "string" ? { label: row.label } : {}),
    });
  }
  if (ranges.length === 0 && obj.previousDurationMs == null && obj.newDurationMs == null) {
    return null;
  }
  return {
    ranges,
    ...(typeof obj.previousDurationMs === "number"
      ? { previousDurationMs: Math.round(obj.previousDurationMs) }
      : {}),
    ...(typeof obj.newDurationMs === "number"
      ? { newDurationMs: Math.round(obj.newDurationMs) }
      : {}),
  };
}

/** Merge overlapping dirty ranges (expand by bufferMs). */
export function markDirtyRange(
  existing: WhiteboardEditRange[],
  startMs: number,
  endMs: number,
  kind: WhiteboardEditRangeKind = "redraw",
  bufferMs = 1500
): WhiteboardEditRange[] {
  const lo = Math.max(0, Math.min(startMs, endMs) - bufferMs);
  const hi = Math.max(startMs, endMs) + bufferMs;
  const next: WhiteboardEditRange[] = [
    ...existing,
    {
      id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      startMs: lo,
      endMs: hi,
      kind,
    },
  ];
  return mergeEditRanges(next);
}

export function mergeEditRanges(ranges: WhiteboardEditRange[]): WhiteboardEditRange[] {
  if (ranges.length <= 1) return ranges.slice();
  const sorted = ranges.slice().sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: WhiteboardEditRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (!last || r.startMs > last.endMs + 500) {
      out.push({ ...r });
      continue;
    }
    last.endMs = Math.max(last.endMs, r.endMs);
    if (r.kind === "trim" || last.kind === "trim") last.kind = "trim";
    else if (r.kind === "audio" || last.kind === "audio") last.kind = "audio";
    if (r.removedMs || last.removedMs) {
      last.removedMs = (last.removedMs ?? 0) + (r.removedMs ?? 0);
    }
  }
  return out;
}
