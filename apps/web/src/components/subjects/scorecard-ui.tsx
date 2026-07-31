import { cn } from "@/lib/utils";

export type PerformanceLevel =
  | "BEGINNER"
  | "BASIC"
  | "DEVELOPING"
  | "INTERMEDIATE"
  | "ADVANCED"
  | "EXPERT";

export type LearningTrend =
  | "RAPID_IMPROVEMENT"
  | "STEADY_IMPROVEMENT"
  | "STABLE"
  | "SLIGHT_DECLINE"
  | "CRITICAL_DECLINE";

export function levelColor(level: PerformanceLevel) {
  switch (level) {
    case "EXPERT":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "ADVANCED":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    case "INTERMEDIATE":
      return "border-accent/40 bg-accent/10 text-accent";
    case "DEVELOPING":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "BASIC":
      return "border-orange-500/40 bg-orange-500/10 text-orange-300";
    default:
      return "border-red-500/40 bg-red-500/10 text-red-300";
  }
}

export function trendColor(trend: LearningTrend) {
  switch (trend) {
    case "RAPID_IMPROVEMENT":
    case "STEADY_IMPROVEMENT":
      return "text-emerald-300";
    case "STABLE":
      return "text-muted";
    case "SLIGHT_DECLINE":
      return "text-amber-300";
    default:
      return "text-red-300";
  }
}

export function trendArrow(trend: LearningTrend) {
  switch (trend) {
    case "RAPID_IMPROVEMENT":
      return "\u2191\u2191";
    case "STEADY_IMPROVEMENT":
      return "\u2191";
    case "STABLE":
      return "\u2192";
    case "SLIGHT_DECLINE":
      return "\u2193";
    default:
      return "\u2193\u2193";
  }
}

/** Small circular progress gauge — used for Mastery/AI Confidence on the
 *  Subject Card and Subject Detail header. */
export function CircularGauge({
  percent,
  label,
  size = 88,
  strokeWidth = 8,
  colorClassName = "stroke-accent",
}: {
  percent: number;
  label?: string;
  size?: number;
  strokeWidth?: number;
  colorClassName?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-white/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("fill-none transition-all duration-700 ease-out", colorClassName)}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-foreground">{Math.round(clamped)}%</span>
        {label && <span className="text-[10px] text-muted">{label}</span>}
      </div>
    </div>
  );
}

/** Labeled progress bar for one scorecard dimension. `null` renders an
 *  explicit "not enough data yet" empty state instead of a fabricated 0%. */
export function ScoreBar({
  label,
  percent,
  estimated,
  hint,
  notEnoughDataLabel,
  estimatedLabel,
}: {
  label: string;
  percent: number | null;
  estimated?: boolean;
  hint?: string;
  notEnoughDataLabel: string;
  estimatedLabel: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1.5">
          {label}
          {estimated && percent != null && (
            <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted">
              {estimatedLabel}
            </span>
          )}
        </span>
        <span className="font-semibold text-foreground">
          {percent != null ? `${Math.round(percent)}%` : notEnoughDataLabel}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            percent != null ? "bg-accent" : "bg-white/10"
          )}
          style={{ width: `${percent != null ? Math.max(2, Math.min(100, percent)) : 0}%` }}
        />
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted/80">{hint}</p>}
    </div>
  );
}
