// The scoring engine's public surface. One import path for callers outside src/lib/scoring, so a screen
// never reaches into an individual formula file and end up depending on a private helper. Re-export only:
// there is no logic here, and nothing is renamed on the way out.
//
// It deliberately does NOT re-export anything from src/lib/motion — lib/motion/reps.ts is the separate,
// heel-slide-only rep counter that ships today, and the two must not be mistaken for one another.

export * from "./types";
export * from "./exerciseConfigs";
export * from "./kinematics";
export * from "./volumeScore";
export * from "./targetScore";
export * from "./correctnessScore";
export * from "./executionScore";
export * from "./repDetector";
export * from "./calibration";
export * from "./jointAngle";
export * from "./cuePriority";
export * from "./checkinSafety";
export * from "./useLiveScoring";
