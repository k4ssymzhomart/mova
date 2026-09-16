// Target Score — how much of the prescribed excursion/position was reached, computed per-rep then
// averaged for the session. Each exercise's formula is spec-verbatim (docx §3/§4): AT_LEAST ratio for
// most exercises, a band table for Mini Squat, a deficit-from-start formula for Short Arc Quad, a
// 70/30 elevation+knee-control split for Straight Leg Raise, a 70/30 hold+stability split for Quad Set.
// Rule enforced everywhere: capped at 100, no bonus for exceeding (spec §2, §9.2) — reaching the target
// never earns more by going further.

import { stabilityScore } from "./kinematics";
import type { ExerciseConfig, RepResult } from "./types";

const QUAD_SET_STABILITY_TOLERANCE_DEG = 5;
const SLR_KNEE_LAG_TARGET_DEG = 10;
const SLR_KNEE_LAG_ZERO_DEG = 30; // provisional falloff floor — spec only defines the <=10deg boundary

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function atLeastRatio(achievedDeg: number, targetDeg: number): number {
  if (targetDeg <= 0) return 0;
  return clampScore((achievedDeg / targetDeg) * 100);
}

function bandScore(config: ExerciseConfig, achievedDeg: number): number {
  const bands = config.targetScoreBands ?? [];
  if (bands.length === 0) return 0;
  const sorted = [...bands].sort((a, b) => a.minDeg - b.minDeg);
  if (achievedDeg < sorted[0].minDeg) return 0;
  for (const band of sorted) {
    const max = band.maxDeg ?? Infinity;
    if (achievedDeg >= band.minDeg && achievedDeg <= max) return band.score;
  }
  // Past the last band's upper bound: score does not increase further (spec: "За пределами 45 score не
  // повышать" for Mini Squat) — stay at the last (highest-range) band's score.
  return sorted[sorted.length - 1].score;
}

function shortArcQuadScore(rep: RepResult): number {
  const start = rep.startAngleDeg;
  const final = rep.finalAngleDeg;
  if (start === undefined || final === undefined) return 0;
  if (final <= 5) return 100;
  const targetExcursion = start - 5;
  if (targetExcursion <= 0) return 0;
  return clampScore(((start - final) / targetExcursion) * 100);
}

function straightLegRaiseScore(config: ExerciseConfig, rep: RepResult): number {
  const elevationSubscore = atLeastRatio(rep.peakExcursionDeg, config.targetValueDeg ?? 30);
  const kneeLag = rep.secondaryMetricDeg ?? 0;
  const kneeControlSubscore =
    kneeLag <= SLR_KNEE_LAG_TARGET_DEG
      ? 100
      : clampScore(100 * (1 - (kneeLag - SLR_KNEE_LAG_TARGET_DEG) / (SLR_KNEE_LAG_ZERO_DEG - SLR_KNEE_LAG_TARGET_DEG)));
  return clampScore(0.7 * elevationSubscore + 0.3 * kneeControlSubscore);
}

function quadSetScore(config: ExerciseConfig, rep: RepResult): number {
  const holdSubscore = config.holdTargetSec ? clampScore((rep.holdSec / config.holdTargetSec) * 100) : 0;
  const stabilitySubscore = stabilityScore(rep.peakExcursionDeg, QUAD_SET_STABILITY_TOLERANCE_DEG);
  return clampScore(0.7 * holdSubscore + 0.3 * stabilitySubscore);
}

/** 0..100 Target Score for a single rep. Returns 0 for a rep that isn't valid-for-volume — an
 *  incomplete/sensor-lost rep contributes nothing to the target average. */
export function perRepTargetScore(config: ExerciseConfig, rep: RepResult): number {
  if (!rep.validForVolume) return 0;
  switch (config.slug) {
    case "short_arc_quad":
      return shortArcQuadScore(rep);
    case "straight_leg_raise":
      return straightLegRaiseScore(config, rep);
    case "quad_set":
      return quadSetScore(config, rep);
    case "mini_squat":
      return bandScore(config, rep.peakExcursionDeg);
    default:
      return config.targetValueDeg === null ? 0 : atLeastRatio(rep.peakExcursionDeg, config.targetValueDeg);
  }
}

/** Session-level Target Score: mean of the valid reps' per-rep scores. 0 when there are no valid reps
 *  (never fabricate a number from zero data). */
export function sessionTargetScore(config: ExerciseConfig, reps: RepResult[]): number {
  const valid = reps.filter((r) => r.validForVolume);
  if (valid.length === 0) return 0;
  const scores = valid.map((r) => perRepTargetScore(config, r));
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** How many reps actually reached the target (per-rep score === 100) — spec's "target_reached_count". */
export function targetReachedCount(config: ExerciseConfig, reps: RepResult[]): number {
  return reps.filter((r) => r.validForVolume && perRepTargetScore(config, r) >= 100).length;
}
