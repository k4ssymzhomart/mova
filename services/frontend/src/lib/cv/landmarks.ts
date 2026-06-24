// MediaPipe Pose — 33-landmark topology. Indices and the connection graph we render as a wireframe.
// Kept framework-free so both the draw layer and the game logic can share one source of truth.

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
} as const;

// Upper-body + limb connections (we omit dense face/hand/foot detail — clinical, not decorative).
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
];

// A single normalized landmark as returned by MediaPipe (x,y in [0,1], z relative, visibility 0..1).
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type PoseFrame = Landmark[]; // length 33
