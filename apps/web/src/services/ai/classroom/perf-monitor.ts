/**
 * Lightweight self-performance monitor for the live classroom pipeline.
 *
 * This does not aim to be a full analytics dashboard — it is a zero-dependency,
 * always-on instrument that logs a single structured line per classroom
 * request with a stage-by-stage latency breakdown (e.g. how long the LLM
 * call took vs. everything else), so bottlenecks show up immediately in
 * server logs without adding any request latency of its own. Combined with
 * the per-call `latencyMs` already recorded on every row of `AiUsageLog`
 * (DeepSeek + Fish Audio calls), this gives full visibility into where time
 * goes for every beat without slowing anything down.
 */

export type PerfStage = {
  label: string;
  ms: number;
};

export class ClassroomPerfTimer {
  private readonly startedAt = Date.now();
  private lastMark = this.startedAt;
  private readonly stages: PerfStage[] = [];

  constructor(private readonly route: string) {}

  /** Records the elapsed time since the previous mark (or start) under `label`. */
  mark(label: string): void {
    const now = Date.now();
    this.stages.push({ label, ms: now - this.lastMark });
    this.lastMark = now;
  }

  /** Logs the full breakdown plus total elapsed time. Call once, at the end. */
  finish(extra?: Record<string, string | number | boolean | null | undefined>): void {
    const total = Date.now() - this.startedAt;
    const breakdown = this.stages.map((s) => `${s.label}=${s.ms}ms`).join(" ");
    const extraBits = extra
      ? Object.entries(extra)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")
      : "";
    const bottleneck = this.stages.reduce(
      (max, s) => (s.ms > max.ms ? s : max),
      { label: "n/a", ms: 0 }
    );
    // Flag anything blowing past the classroom's responsiveness targets so
    // slow requests are impossible to miss while scanning logs.
    const flag = total > 4000 ? " SLOW" : "";
    // eslint-disable-next-line no-console
    console.log(
      `[classroom.perf]${flag} route=${this.route} total=${total}ms bottleneck=${bottleneck.label}(${bottleneck.ms}ms) ${breakdown} ${extraBits}`.trim()
    );
  }
}
