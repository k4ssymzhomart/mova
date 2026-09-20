// Correctness Score — technique, independent of whether the target was reached (spec §1, step 5: "tempo,
// smoothness, контроль возврата, удержание, consistency и доступные IMU-критерии"). Weights per exercise
// come verbatim from the docx (exerciseConfigs.ts); the sub-score MATH is not specified there — see
// kinematics.ts's header for that honesty caveat. "Consistency" is inherently session-level (it compares
// reps to each other), so this computes Correctness at the session level directly — session-mean of each
// per-rep component, plus one consistency term over all valid reps — rather than forcing an artificial
// per-rep consistency value.

import { consistencyScore, controlledReturnScore, holdScore, stabilityScore, tempoScore } from "./kinematics";
import type { ExerciseConfig, RepResult } from "./types";

const SAQ_EXTENSION_TOLERANCE_DEG = 5;
const SLR_KNEE_STABILITY_TARGET_DEG = 10;
const SLR_KNEE_STABILITY_ZERO_DEG = 30;

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** One rep's score for one named correctness component. Falls back to a neutral 100 for a component
 *  this rep has no signal for, rather than crashing or silently zeroing a whole exercise's weighting.
 *
 *  null is different, and stronger: the exercise has no CALIBRATED target for this component, so it
 *  abstains and its weight is redistributed over the components that do have one. A neutral 100
 *  would quietly reward an exercise for something nobody has measured. */
function componentScore(key: string, config: ExerciseConfig, rep: RepResult): number | null {
  switch (key) {
    case "smoothness":
    case "downUpSmoothness":
    case "smoothRise":
      return clampScore(rep.smoothness01 * 100);
    case "tempo":
      return config.tempoRangeSec === null ? null : tempoScore(rep.tempoSec, config.tempoRangeSec);
    case "controlledReturn":
    case "controlledLowering":
    case "return":
      if (config.tempoRangeSec === null) return null;
      return rep.returnDurationSec !== undefined
        ? controlledReturnScore(rep.returnDurationSec, config.tempoRangeSec)
        : 100;
    case "hold":
    case "timing":
      return config.holdTargetSec ? holdScore(rep.holdSec, config.holdTargetSec) : 100;
    case "stability":
      // Quad Set's own "stability" weight, distinct from kneeStability (SLR) — movement during a hold.
      return stabilityScore(rep.peakExcursionDeg, 5);
    case "kneeStability": {
      // 100 when lag is at/under the 10deg clinical target; falls to 0 by the time lag reaches 30deg.
      const lag = rep.secondaryMetricDeg ?? 0;
      const excess = Math.max(0, lag - SLR_KNEE_STABILITY_TARGET_DEG);
      return stabilityScore(excess, SLR_KNEE_STABILITY_ZERO_DEG - SLR_KNEE_STABILITY_TARGET_DEG);
    }
    case "extensionControl": {
      // Short Arc Quad: how cleanly the rep reached its own end-point, independent of hitting the
      // <=5deg clinical target — a full, controlled extension attempt scores well even if short of goal.
      if (rep.startAngleDeg === undefined || rep.finalAngleDeg === undefined) return 100;
      const deficit = Math.max(0, rep.finalAngleDeg - SAQ_EXTENSION_TOLERANCE_DEG);
      return clampScore(100 * (1 - deficit / Math.max(1, rep.startAngleDeg - SAQ_EXTENSION_TOLERANCE_DEG)));
    }
    case "cycleCompleteness":
      return rep.completed ? 100 : 0;
    case "bottomControl":
      // No dedicated "control at the bottom of the squat" signal exists yet — approximate with overall
      // smoothness, documented as provisional same as the rest of this module.
      return clampScore(rep.smoothness01 * 100);
    default:
      return 100;
  }
}

/** Session-mean of one component across valid reps; 0 when there are none (never fabricate).
 *  null when the component abstains for this exercise — see componentScore. */
function sessionComponentMean(key: string, config: ExerciseConfig, reps: RepResult[]): number | null {
  const valid = reps.filter((r) => r.validForVolume);
  if (valid.length === 0) return 0;
  let total = 0;
  for (const rep of valid) {
    const value = componentScore(key, config, rep);
    // Abstention is a property of the exercise's config, not of one rep, so the first
    // null settles it for the whole component.
    if (value === null) return null;
    total += value;
  }
  return Math.round(total / valid.length);
}

/** 0..100 session-level Correctness Score — the weighted sum feeding Execution Effectiveness.
 *
 *  Components that abstain are left out and the remaining weights are renormalized over what was
 *  actually used, so an uncalibrated sub-metric never counts as a zero and never counts as a free
 *  100. This mirrors PHOENIX's rep_correctness, which divides by its used_weight for the same reason. */
export function sessionCorrectnessScore(config: ExerciseConfig, reps: RepResult[]): number {
  const valid = reps.filter((r) => r.validForVolume);
  if (valid.length === 0) return 0;

  let total = 0;
  let usedWeight = 0;
  for (const [key, weight] of Object.entries(config.correctnessWeights)) {
    const value =
      key === "consistency"
        ? consistencyScore(valid.map((r) => r.peakExcursionDeg))
        : sessionComponentMean(key, config, reps);
    if (value === null) continue;
    total += weight * value;
    usedWeight += weight;
  }
  // Every component abstained: there is nothing measured to report, so say 0 rather than invent one.
  if (usedWeight <= 0) return 0;
  return clampScore(total / usedWeight);
}

/** Per-rep correctness for display/live-feedback purposes (e.g. "low smoothness" cueing) — excludes the
 *  session-only "consistency" term, with the remaining weights renormalized over the components that
 *  did not abstain. */
export function perRepCorrectnessScore(config: ExerciseConfig, rep: RepResult): number {
  let total = 0;
  let usedWeight = 0;
  for (const [key, weight] of Object.entries(config.correctnessWeights)) {
    if (key === "consistency") continue;
    const value = componentScore(key, config, rep);
    if (value === null) continue;
    total += weight * value;
    usedWeight += weight;
  }
  if (usedWeight <= 0) return 100;
  return clampScore(total / usedWeight);
}
