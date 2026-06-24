// Pure-canvas skeletal wireframe renderer. Strict monochrome: black ink on whatever stage the caller
// clears to. No colour, no glow — a precise wireframe, like a vector schematic of the body.

import { Landmark, POSE_CONNECTIONS, POSE_LANDMARKS } from "./landmarks";

export interface DrawOptions {
  width: number;
  height: number;
  mirror?: boolean; // selfie view: flip X so the patient's right is on screen-right
  minVisibility?: number;
  ink?: string;
}

function px(l: Landmark, w: number, h: number, mirror: boolean): [number, number] {
  const x = mirror ? 1 - l.x : l.x;
  return [x * w, l.y * h];
}

/** Draw the 33-point pose as edges + joints. Returns nothing; clears nothing (caller owns the stage). */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  opts: DrawOptions,
): void {
  const { width, height, mirror = true, minVisibility = 0.5, ink = "#000000" } = opts;
  if (!landmarks?.length) return;

  ctx.lineWidth = 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = "square";

  // edges
  for (const [a, b] of POSE_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (!la || !lb) continue;
    if ((la.visibility ?? 1) < minVisibility || (lb.visibility ?? 1) < minVisibility) continue;
    const [ax, ay] = px(la, width, height, mirror);
    const [bx, by] = px(lb, width, height, mirror);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // joints — small sharp squares (no circles; the design language is geometric)
  const s = 5;
  for (const idx of Object.values(POSE_LANDMARKS)) {
    const l = landmarks[idx];
    if (!l || (l.visibility ?? 1) < minVisibility) continue;
    const [x, y] = px(l, width, height, mirror);
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
}

/** Wrist position in canvas pixels for the chosen side, or null if not confidently tracked. */
export function wristPx(
  landmarks: Landmark[],
  side: "left" | "right",
  width: number,
  height: number,
  mirror = true,
  minVisibility = 0.5,
): [number, number] | null {
  const idx = side === "left" ? POSE_LANDMARKS.leftWrist : POSE_LANDMARKS.rightWrist;
  const l = landmarks?.[idx];
  if (!l || (l.visibility ?? 1) < minVisibility) return null;
  return px(l, width, height, mirror);
}

/** Pixel position of any landmark index, or null if missing / below the visibility floor. */
export function landmarkPx(
  landmarks: Landmark[],
  idx: number,
  width: number,
  height: number,
  mirror = true,
  minVisibility = 0.5,
): [number, number] | null {
  const l = landmarks?.[idx];
  if (!l || (l.visibility ?? 1) < minVisibility) return null;
  return px(l, width, height, mirror);
}

const LEG_EDGES: ReadonlyArray<readonly [number, number]> = [
  [POSE_LANDMARKS.leftHip, POSE_LANDMARKS.leftKnee],
  [POSE_LANDMARKS.leftKnee, POSE_LANDMARKS.leftAnkle],
  [POSE_LANDMARKS.rightHip, POSE_LANDMARKS.rightKnee],
  [POSE_LANDMARKS.rightKnee, POSE_LANDMARKS.rightAnkle],
];

/** Re-draw the lower-limb chain in the emerald signal colour — used in gait mode to focus the legs. */
export function drawLegAccent(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  opts: DrawOptions,
): void {
  const { width, height, mirror = true, minVisibility = 0.5 } = opts;
  if (!landmarks?.length) return;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#16a35b";
  ctx.fillStyle = "#16a35b";
  ctx.lineCap = "round";
  for (const [a, b] of LEG_EDGES) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (!la || !lb) continue;
    if ((la.visibility ?? 1) < minVisibility || (lb.visibility ?? 1) < minVisibility) continue;
    const [ax, ay] = px(la, width, height, mirror);
    const [bx, by] = px(lb, width, height, mirror);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  for (const idx of [
    POSE_LANDMARKS.leftKnee,
    POSE_LANDMARKS.rightKnee,
    POSE_LANDMARKS.leftAnkle,
    POSE_LANDMARKS.rightAnkle,
  ]) {
    const l = landmarks[idx];
    if (!l || (l.visibility ?? 1) < minVisibility) continue;
    const [x, y] = px(l, width, height, mirror);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
