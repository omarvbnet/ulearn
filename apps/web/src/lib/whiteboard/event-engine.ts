import type { TimelineCue, UbrdEvent, UbrdTimeline } from "./types";

/** In-memory event recorder / playback applicator foundation. */
export class EventEngine {
  private events: UbrdEvent[] = [];
  private startedAt: number | null = null;

  get isRecording() {
    return this.startedAt != null;
  }

  get length() {
    return this.events.length;
  }

  get all(): readonly UbrdEvent[] {
    return this.events;
  }

  start(now = Date.now()) {
    this.events = [];
    this.startedAt = now;
  }

  /** Elapsed ms since start; 0 if not recording. */
  now(wall = Date.now()) {
    if (this.startedAt == null) return 0;
    return Math.max(0, wall - this.startedAt);
  }

  push(type: UbrdEvent["type"], payload: Record<string, unknown>, id?: string): UbrdEvent {
    const ev: UbrdEvent = {
      id: id ?? `e_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`,
      t: this.now(),
      type,
      payload,
    };
    this.events.push(ev);
    return ev;
  }

  /** Load a finalized event list (playback / crash recovery). */
  load(events: UbrdEvent[]) {
    this.startedAt = null;
    this.events = events.slice().sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  }

  stop(durationMs?: number) {
    const t = durationMs ?? this.now();
    this.push("session_end", { durationMs: t });
    this.startedAt = null;
    return t;
  }

  eventsUpTo(t: number): UbrdEvent[] {
    const out: UbrdEvent[] = [];
    for (const e of this.events) {
      if (e.t > t) break;
      out.push(e);
    }
    return out;
  }

  /** Binary search first index with event.t > t */
  indexAfter(t: number): number {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid]!.t <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  buildTimeline(intervalMs = 5000, maxDurationMs?: number): UbrdTimeline {
    const cues: TimelineCue[] = [{ t: 0, eventOffset: 0, snapshot: null }];
    if (this.events.length === 0) return { cues, intervalMs };

    const lastT = this.events[this.events.length - 1]!.t;
    const maxT = Math.min(
      maxDurationMs ?? lastT,
      lastT,
      24 * 60 * 60 * 1000 // hard cap 24h
    );
    for (let t = intervalMs; t <= maxT; t += intervalMs) {
      cues.push({ t, eventOffset: this.indexAfter(t - 1), snapshot: null });
    }
    return { cues, intervalMs };
  }

  toNdjson(): string {
    return this.events.map((e) => JSON.stringify(e)).join("\n") + (this.events.length ? "\n" : "");
  }

  static parseNdjson(text: string): UbrdEvent[] {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as UbrdEvent);
  }
}
