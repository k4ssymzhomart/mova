// Target Score — how much of the prescribed excursion/position was reached, computed per-rep then
// averaged for the session. Each exercise's formula is spec-verbatim (docx §3/§4): AT_LEAST ratio for
// most exercises, a band table for Mini Squat, a deficit-from-start formula for Short Arc Quad, a
// 70/30 elevation+knee-control split for Straight Leg Raise, a 70/30 hold+stability split for Quad Set.
// Rule enforced everywhere: capped at 100, no bonus for exceeding (spec §2, §9.2) — reaching the target
// never earns more by going further.
//
// The second rule, added with the abstention patch: this file never reports a number it did not measure.
//   * "The patient did not get there" is a real, measured zero and stays a zero. A rep that is not
//     valid for volume scores 0, and a squat shallower than the lowest band scores 0.
//   * "There was nothing to measure against" is null. No configured target, an empty band table, a
//     Short Arc Quad rep with no calibration angles, a Quad Set with no hold target — all abstain.
// Before this, a null targetValueDeg scored 0, which cost an exercise 30 points of its Execution Score
// for having nothing to measure. That penalty is why exerciseConfigs.ts invented a 20deg target for
// resisted_ankle_pump (its comment at :87-91 says so outright); with Target able to abstain, that
// invented number can be reverted in a separate, clinically-signed-off change.

import { stabilityScore } from "./kinematics";
import type { ComponentScore, ExerciseConfig, RepResult } from "./types";

const QUAD_SET_STABILITY_TOLERANCE_DEG = 5;
const SLR_KNEE_LAG_TARGET_DEG = 10;
const SLR_KNEE_LAG_ZERO_DEG = 30; // provisional falloff floor — spec only defines the <=10deg boundary
/** The docx §4 split for Straight Leg Raise. Kept as named constants because the knee-control half is
 *  dropped and the elevation half renormalised whenever a rep carries no knee-lag reading. */
const SLR_ELEVATION_WEIGHT = 0.7;
const SLR_KNEE_CONTROL_WEIGHT = 0.3;

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** null when the target itself is unusable (zero or negative); a real ratio otherwise. */
function atLeastRatio(achievedDeg: number, targetDeg: number): number | null {
  if (targetDeg <= 0) return null;
  return clampScore((achievedDeg / targetDeg) * 100);
}

function bandScore(config: ExerciseConfig, achievedDeg: number): number | null {
  const bands = config.targetScoreBands ?? [];
  // A band exercise with no band table has no target to score against at all.
  if (bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => a.minDeg - b.minDeg);
  // Below the lowest band is a measured miss, not an abstention.
  if (achievedDeg < sorted[0].minDeg) return 0;
  for (const band of sorted) {
    const max = band.maxDeg ?? Infinity;
    if (achievedDeg >= band.minDeg && achievedDeg <= max) return band.score;
  }
  // Past the last band's upper bound: score does not increase further (spec: "За пределами 45 score не
  // повышать" for Mini Squat) — stay at the last (highest-range) band's score.
  return sorted[sorted.length - 1].score;
}

function shortArcQuadScore(rep: RepResult): number | null {
  const start = rep.startAngleDeg;
  const final = rep.finalAngleDeg;
  // These two only exist when useLiveScoring was given calibrationBaselineAbsoluteDeg. Without them
  // the exercise's whole formula has no inputs, so it abstains rather than scoring the patient 0.
  if (start === undefined || final === undefined) return null;
  if (final <= 5) return 100;
  const targetExcursion = start - 5;
  // A calibrated start already at or past the 5deg goal leaves no range to score across.
  if (targetExcursion <= 0) return null;
  return clampScore(((start - final) / targetExcursion) * 100);
}

function straightLegRaiseScore(config: ExerciseConfig, rep: RepResult): number | null {
  // The elevation half needs a configured target; there is no default to fall back on that would not
  // be an invented clinical number.
  if (config.targetValueDeg === null) return null;
  const elevationSubscore = atLeastRatio(rep.peakExcursionDeg, config.targetValueDeg);
  if (elevationSubscore === null) return null;

  // Knee extension lag is a separate sensor reading and is often absent. When it is, the knee-control
  // half is left out and the elevation half carries the whole score — the same redistribution this
  // engine does everywhere else — rather than reading "no reading" as a perfectly locked knee.
  if (rep.secondaryMetricDeg === undefined) return clampScore(elevationSubscore);
  const kneeLag = rep.secondaryMetricDeg;
  const kneeControlSubscore =
    kneeLag <= SLR_KNEE_LAG_TARGET_DEG
      ? 100
      : clampScore(100 * (1 - (kneeLag - SLR_KNEE_LAG_TARGET_DEG) / (SLR_KNEE_LAG_ZERO_DEG - SLR_KNEE_LAG_TARGET_DEG)));
  return clampScore(SLR_ELEVATION_WEIGHT * elevationSubscore + SLR_KNEE_CONTROL_WEIGHT * kneeControlSubscore);
}

function quadSetScore(config: ExerciseConfig, rep: RepResult): number | null {
  // Quad Set is 70% hold duration against a target. With no target there is no hold ratio, and the
  // remaining stability term alone is not this exercise's Target Score, so the rep abstains.
  if (!config.holdTargetSec) return null;
  const holdSubscore = clampScore((rep.holdSec / config.holdTargetSec) * 100);
  const stabilitySubscore = stabilityScore(rep.peakExcursionDeg, QUAD_SET_STABILITY_TOLERANCE_DEG);
  return clampScore(0.7 * holdSubscore + 0.3 * stabilitySubscore);
}

/** 0..100 Target Score for a single rep, or null when this exercise has nothing to measure the rep
 *  against. Returns 0 — a real zero — for a rep that isn't valid-for-volume: an incomplete or
 *  sensor-lost rep reached none of the target, which is a different statement from "no target". */
export function perRepTargetScore(config: ExerciseConfig, rep: RepResult): number | null {
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
      return config.targetValueDeg === null ? null : atLeastRatio(rep.peakExcursionDeg, config.targetValueDeg);
  }
}

/** Session-level Target Score: mean of the valid reps' per-rep scores, as a ComponentScore so the
 *  rollup can tell "0% of the target" apart from "this exercise has no target".
 *
 *  Target is a single component, so `measured`/`abstained` carry at most the one name "target". Reps
 *  that abstained individually are excluded from the mean; the count of them is not surfaced here
 *  because ComponentScore has no room for it, and inventing a second meaning for `weightUsed` would
 *  make the field mean two different things in the two places it is read. */
export function sessionTargetScore(config: ExerciseConfig, reps: RepResult[]): ComponentScore {
  const valid = reps.filter((r) => r.validForVolume);
  if (valid.length === 0) return { score: null, measured: [], abstained: ["target"], weightUsed: 0 };
  const scores = valid.map((r) => perRepTargetScore(config, r)).filter((s): s is number => s !== null);
  if (scores.length === 0) return { score: null, measured: [], abstained: ["target"], weightUsed: 0 };
  return {
    score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    measured: ["target"],
    abstained: [],
    weightUsed: 1,
  };
}

/** How many reps actually reached the target (per-rep score === 100) — spec's "target_reached_count".
 *  A rep whose target score abstained has not reached anything measurable and is not counted. */
export function targetReachedCount(config: ExerciseConfig, reps: RepResult[]): number {
  return reps.filter((r) => {
    if (!r.validForVolume) return false;
    const score = perRepTargetScore(config, r);
    return score !== null && score >= 100;
  }).length;
}
