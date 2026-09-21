// MediaPipe Pose — 33-landmark topology. Indices and the connection graph we render as a wireframe.
// Kept framework-free so both the draw layer and the game logic can share one source of truth.
//
// The foot points (heel 29/30, foot_index 31/32) are here because this is a lower-limb app: without
// them there is no knee–ankle–foot chain, so ankle dorsiflexion cannot be formed at all. MediaPipe
// has always returned them; they were simply not listed. Everything else in the 33-point topology
// that we still leave out (face mesh, hands) is decorative for our purposes and stays out.

export const POSE_LANDMARKS = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

// Upper-body + limb connections (we omit dense face/hand detail — clinical, not decorative).
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // left arm
  [11, 13], [13, 15],
  // right arm
  [12, 14], [14, 16],
  // left leg
  [23, 25], [25, 27],
  // right leg
  [24, 26], [26, 28],
  // feet — the triangle ankle → heel → foot_index → ankle. It closes so the foot reads as a segment
  // with a direction, which is what makes the ankle angle legible on screen.
  [27, 29], [29, 31], [27, 31],
  [28, 30], [30, 32], [28, 32],
];

// A single normalized landmark as returned by MediaPipe (x,y in [0,1], z relative, visibility 0..1).
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type PoseFrame = Landmark[]; // length 33
