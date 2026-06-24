// Range-of-motion proxies from MediaPipe world landmarks (metric, hip-centered, +Y points down).
//
// Both measures are joint-elevation angles relative to world-down, which makes them placement- and
// scale-free and robust enough for a 60-second home baseline:
//   armElevationDeg  = angle(upper-arm, down)  — 0° hanging, ~180° fully overhead (shoulder elevation)
//   kneeRaiseDeg     = angle(thigh, down)      — 0° standing, ~90°+ at a high march (hip flexion)

import type { Landmark } from "./landmarks";
import { POSE_LANDMARKS } from "./landmarks";

type V3 = [number, number, number];
const DOWN: V3 = [0, 1, 0]; // world down in MediaPipe's frame

function sub(a: Landmark, b: Landmark): V3 {
  return [a.x - b.x, a.y - b.y, a.z - b.z];
}

function angleToDownDeg(v: V3): number {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, (v[0] * DOWN[0] + v[1] * DOWN[1] + v[2] * DOWN[2]) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

function tracked(a?: Landmark, b?: Landmark, minVis = 0.4): boolean {
  return !!a && !!b && (a.visibility ?? 1) >= minVis && (b.visibility ?? 1) >= minVis;
}

/** Shoulder-elevation angle (deg) for one side, or null if the joints aren't confidently tracked. */
export function armElevationDeg(world: Landmark[], side: "left" | "right", minVis = 0.4): number | null {
  const sh = world[side === "left" ? POSE_LANDMARKS.leftShoulder : POSE_LANDMARKS.rightShoulder];
  const el = world[side === "left" ? POSE_LANDMARKS.leftElbow : POSE_LANDMARKS.rightElbow];
  if (!tracked(sh, el, minVis)) return null;
  return angleToDownDeg(sub(el, sh)); // upper-arm vector
}

/** Hip-flexion (knee-raise) angle (deg) for one side, or null if the joints aren't confidently tracked. */
export function kneeRaiseDeg(world: Landmark[], side: "left" | "right", minVis = 0.4): number | null {
  const hip = world[side === "left" ? POSE_LANDMARKS.leftHip : POSE_LANDMARKS.rightHip];
  const knee = world[side === "left" ? POSE_LANDMARKS.leftKnee : POSE_LANDMARKS.rightKnee];
  if (!tracked(hip, knee, minVis)) return null;
  return angleToDownDeg(sub(knee, hip)); // thigh vector
}
