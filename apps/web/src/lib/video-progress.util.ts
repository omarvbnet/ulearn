/** Derive watch completion from position, duration, or an explicit finished flag. */
export function computeVideoCompletion(params: {
  positionSec: number;
  durationSec: number;
  completed?: boolean;
}) {
  const { positionSec, durationSec, completed } = params;
  const nearEnd =
    durationSec > 0 && positionSec >= Math.max(0, durationSec - 5);
  const completionPct =
    durationSec > 0
      ? Math.min(100, (positionSec / durationSec) * 100)
      : completed
        ? 100
        : 0;
  const isCompleted = completed === true || nearEnd || completionPct >= 90;

  return {
    positionSec: isCompleted && durationSec > 0 ? durationSec : positionSec,
    completionPct: isCompleted ? 100 : completionPct,
    isCompleted,
  };
}
