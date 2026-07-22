import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The U Learn logo as pure SVG code (no image asset): a circuit-board
 * letter "U" with staggered traces, connection nodes, branch elbows and
 * dissolving pixels, stroked with the brand purple → cyan gradient.
 *
 * Pass `animated` to make the traces draw themselves in (keyframes live
 * in globals.css: ulearn-draw / ulearn-pop / ulearn-glow).
 */

// (left x, right x, bottom radius, left top y, right top y)
const TRACES: [number, number, number, number, number][] = [
  [52, 148, 48, 40, 28],
  [64, 136, 36, 26, 44],
  [76, 124, 24, 46, 32],
  [88, 112, 12, 30, 52],
];

// (start x, start y, dx, dy) — horizontal then vertical elbow
const BRANCHES: [number, number, number, number][] = [
  [52, 78, -14, -16],
  [148, 70, 14, -18],
  [136, 96, 16, 14],
  [64, 104, -16, 12],
];

// (x, y, size, opacity) — dissolving pixels, top-left diagonal
const PIXELS: [number, number, number, number][] = [
  [18, 14, 7, 0.55],
  [34, 22, 5, 0.75],
  [24, 34, 9, 0.65],
  [44, 10, 4, 0.5],
  [48, 30, 6, 0.9],
  [12, 48, 5, 0.45],
  [36, 44, 8, 0.85],
  [56, 18, 5, 0.7],
  [28, 58, 6, 0.6],
  [46, 56, 4, 0.8],
];

const BOTTOM_Y = 118;

function tracePath([xL, xR, r, tL, tR]: [number, number, number, number, number]) {
  return `M ${xL} ${tL} L ${xL} ${BOTTOM_Y} A ${r} ${r} 0 0 0 ${xR} ${BOTTOM_Y} L ${xR} ${tR}`;
}

export function ULearnLogo({
  size = 40,
  animated = false,
  glow = true,
  className,
}: {
  size?: number;
  animated?: boolean;
  glow?: boolean;
  className?: string;
}) {
  const id = useId();
  const gradId = `ulg-${id}`;
  const glowId = `ulb-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      role="img"
      aria-label="U Learn"
      className={cn(animated && "ulearn-logo-animated", className)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#B44CF0" />
          <stop offset="0.25" stopColor="#A020F0" />
          <stop offset="0.6" stopColor="#3D8BFF" />
          <stop offset="1" stopColor="#00E5FF" />
        </linearGradient>
        <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g filter={glow ? `url(#${glowId})` : undefined}>
        {TRACES.map((t, i) => (
          <path
            key={i}
            d={tracePath(t)}
            stroke={`url(#${gradId})`}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="ulearn-trace"
            style={animated ? { animationDelay: `${i * 0.18}s` } : undefined}
          />
        ))}

        {BRANCHES.map(([sx, sy, dx, dy], i) => (
          <path
            key={i}
            d={`M ${sx} ${sy} h ${dx} v ${dy}`}
            stroke={`url(#${gradId})`}
            strokeWidth={3.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="ulearn-trace"
            style={animated ? { animationDelay: `${0.9 + i * 0.12}s` } : undefined}
          />
        ))}

        {/* connection nodes at trace tips and branch ends */}
        {[
          ...TRACES.flatMap(([xL, xR, , tL, tR]) => [
            [xL, tL, 4.4],
            [xR, tR, 4.4],
          ]),
          ...BRANCHES.map(([sx, sy, dx, dy]) => [sx + dx, sy + dy, 3.2]),
        ].map(([cx, cy, r], i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="#050510"
            stroke={`url(#${gradId})`}
            strokeWidth={r > 4 ? 3 : 2.4}
            className="ulearn-node"
            style={animated ? { animationDelay: `${1 + (i % 6) * 0.1}s` } : undefined}
          />
        ))}
      </g>

      {PIXELS.map(([x, y, s, o], i) => (
        <rect
          key={i}
          x={x - s / 2}
          y={y - s / 2}
          width={s}
          height={s}
          rx={1.2}
          fill={["#B44CF0", "#9A3AF0", "#7B2FF0"][i % 3]}
          opacity={o}
          className="ulearn-pixel"
          style={animated ? { animationDelay: `${0.6 + (i % 5) * 0.14}s` } : undefined}
        />
      ))}
    </svg>
  );
}
