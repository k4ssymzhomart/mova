// Pose -> Virtual IMU, in the browser.
//
// Ports the Phase-1/3 virtual-IMU physics (mova/synth/rotations.py) to TypeScript so MediaPipe's
// metric world-landmarks become the same 6-channel signal (acc in g, gyro in rad/s) the ONNX models
// were trained on. Per limb segment we build an orthonormal body frame from three joints, then:
//
//   gyro  = body-frame angular velocity  = logmap(R_tᵀ · R_{t+1}) / dt           (rad/s)
//   accel = Rᵀ · ( d²x/dt²  +  g )                                                (m/s² -> /g)
//
// The absolute frame convention differs from the SMPL/real-sensor frame, but the SSL encoder was
// pretrained with random-SO(3) augmentation, so it is largely orientation-invariant — which is exactly
// why a video-derived frame can drive a model trained on worn sensors.

import type { Landmark } from "./landmarks";
import { POSE_LANDMARKS } from "./landmarks";

const GRAVITY = 9.80665;
const EPS = 1e-8;
// MediaPipe world landmarks: +Y points down, so world-up is -Y. Gravity reaction (specific force at
// rest) points up.
const G_VEC: Vec3 = [0, -GRAVITY, 0];

export type Vec3 = [number, number, number];
export type Mat3 = number[]; // row-major length 9
export type Side = "left" | "right";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Rᵀ·v where R is column-basis [x|y|z] row-major. */
function matTVec(R: Mat3, v: Vec3): Vec3 {
  return [
    R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
    R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
    R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
  ];
}

/** rel = Aᵀ·B (both row-major). */
function matTMat(A: Mat3, B: Mat3): Mat3 {
  const out = new Array(9).fill(0);
  for (let i = 0; i < 3; i += 1)
    for (let k = 0; k < 3; k += 1) {
      let s = 0;
      for (let j = 0; j < 3; j += 1) s += A[j * 3 + i] * B[j * 3 + k];
      out[i * 3 + k] = s;
    }
  return out;
}

// A virtual sensor lives on a limb *segment*, built from three joints: proximal → mid → distal.
// The body frame's long axis runs mid→distal and the sensor "sits" at the distal joint — so the
// forearm sensor reads like a wrist/forearm IMU and the shank sensor reads like an ankle IMU, which is
// exactly the Daphnet-FoG placement the fog.onnx graph was trained on.
export type Segment = "forearm" | "shank";

const SEG_JOINTS: Record<Segment, Record<Side, readonly [number, number, number]>> = {
  forearm: {
    left: [POSE_LANDMARKS.leftShoulder, POSE_LANDMARKS.leftElbow, POSE_LANDMARKS.leftWrist],
    right: [POSE_LANDMARKS.rightShoulder, POSE_LANDMARKS.rightElbow, POSE_LANDMARKS.rightWrist],
  },
  shank: {
    left: [POSE_LANDMARKS.leftHip, POSE_LANDMARKS.leftKnee, POSE_LANDMARKS.leftAnkle],
    right: [POSE_LANDMARKS.rightHip, POSE_LANDMARKS.rightKnee, POSE_LANDMARKS.rightAnkle],
  },
};

/**
 * Orthonormal body frame + position for a limb `segment` of `side`, from world landmarks.
 * x = segment long axis (mid→distal: elbow→wrist, or knee→ankle); z ⟂ the proximal-link plane;
 * y completes the basis; the sensor position is the distal joint (wrist / ankle).
 * Returns null if the three joints are not confidently tracked.
 */
export function segmentFrame(
  world: Landmark[],
  segment: Segment,
  side: Side,
  minVis = 0.3,
): { R: Mat3; pos: Vec3 } | null {
  const [pi, mi, di] = SEG_JOINTS[segment][side];
  const p = world[pi];
  const m = world[mi];
  const d = world[di];
  if (!p || !m || !d) return null;
  if ((p.visibility ?? 1) < minVis || (m.visibility ?? 1) < minVis || (d.visibility ?? 1) < minVis)
    return null;
  const P: Vec3 = [p.x, p.y, p.z];
  const M: Vec3 = [m.x, m.y, m.z];
  const D: Vec3 = [d.x, d.y, d.z];
  const x = unit(sub(D, M)); // segment long axis
  const up = sub(M, P); // proximal link (reference)
  let z = cross(x, up);
  if (norm(z) < EPS) z = cross(x, [x[1], x[2], x[0]]); // degenerate guard
  z = unit(z);
  const y = unit(cross(z, x));
  // column-basis [x|y|z], row-major
  const R: Mat3 = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  return { R, pos: D };
}

/** Back-compat shorthand for the upper-limb (reaching) sensor. */
export function forearmFrame(world: Landmark[], side: Side, minVis = 0.3) {
  return segmentFrame(world, "forearm", side, minVis);
}

/** Body-frame angular velocity (rad/s) between two orientation samples — ports angular_velocity(). */
export function gyroFromFrames(Rprev: Mat3, Rcur: Mat3, dt: number): Vec3 {
  if (dt <= 0) return [0, 0, 0];
  const rel = matTMat(Rprev, Rcur);
  const tr = rel[0] + rel[4] + rel[8];
  const angle = Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)));
  const vec: Vec3 = [rel[7] - rel[5], rel[2] - rel[6], rel[3] - rel[1]];
  const n = norm(vec);
  const axis: Vec3 = n < EPS ? [0, 0, 0] : [vec[0] / n, vec[1] / n, vec[2] / n];
  return [(axis[0] * angle) / dt, (axis[1] * angle) / dt, (axis[2] * angle) / dt];
}

/** Body-frame specific force (m/s²) — ports specific_force_body() with central 2nd difference. */
export function accelFromPositions(pPrev: Vec3, pCur: Vec3, pNext: Vec3, Rcur: Mat3, dt: number): Vec3 {
  if (dt <= 0) return matTVec(Rcur, G_VEC);
  const inv = 1 / (dt * dt);
  const aWorld: Vec3 = [
    (pNext[0] - 2 * pCur[0] + pPrev[0]) * inv,
    (pNext[1] - 2 * pCur[1] + pPrev[1]) * inv,
    (pNext[2] - 2 * pCur[2] + pPrev[2]) * inv,
  ];
  const total: Vec3 = [aWorld[0] + G_VEC[0], aWorld[1] + G_VEC[1], aWorld[2] + G_VEC[2]];
  return matTVec(Rcur, total);
}
