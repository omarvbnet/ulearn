import {
  LOGICAL_BOARD_HEIGHT,
  LOGICAL_BOARD_WIDTH,
  boardThemeColors,
  type WhiteboardThemeId,
} from "./types";

/** Draw a classroom-style board face (white / green chalk / blackboard). */
export function paintBoardSurface(
  ctx: CanvasRenderingContext2D,
  theme: WhiteboardThemeId,
  width = LOGICAL_BOARD_WIDTH,
  height = LOGICAL_BOARD_HEIGHT
) {
  const colors = boardThemeColors(theme);
  const gradient = ctx.createLinearGradient(0, 0, width * 0.15, height);
  gradient.addColorStop(0, colors.surface);
  gradient.addColorStop(1, colors.surfaceDeep);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    width / 2,
    height * 0.42,
    0,
    width / 2,
    height * 0.42,
    width * 0.72
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, theme === "WHITE" ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.28)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  if (theme === "WHITE") {
    ctx.strokeStyle = "rgba(15,23,42,0.08)";
    ctx.lineWidth = 1.2;
    for (let y = 48; y < height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(width - 24, y);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    let seed = theme === "GREEN" ? 17 : 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 140; i++) {
      const x = rnd() * width;
      const y = rnd() * height;
      const r = rnd() * 1.8 + 0.4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const rail = ctx.createLinearGradient(0, height - 28, 0, height);
    rail.addColorStop(0, "rgba(255,255,255,0)");
    rail.addColorStop(1, theme === "GREEN" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.08)");
    ctx.fillStyle = rail;
    ctx.fillRect(0, height - 28, width, 28);
  }

  ctx.strokeStyle = theme === "WHITE" ? "rgba(16,24,39,0.13)" : "rgba(0,0,0,0.2)";
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, width - 10, height - 10);
}
