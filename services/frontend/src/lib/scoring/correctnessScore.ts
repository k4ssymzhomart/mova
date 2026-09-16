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
 *  this rep has no signal for, rather than crashing or silently zeroing a whole exercise's weighting. */
function componentScore(key: string, config: ExerciseConfig, rep: RepResult): number {
  switch (key) {
    case "smoothness":
    case "downUpSmoothness":
    case "smoothRise":
      return clampScore(rep.smoothness01 * 100);
    case "tempo":
      return tempoScore(rep.tempoSec, config.tempoRangeSec);
    case "controlledReturn":
    case "controlledLowering":
    case "return":
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

/** Session-mean of one component across valid reps; 0 when there are none (never fabricate). */
function sessionComponentMean(key: string, config: ExerciseConfig, reps: RepResult[]): number {
  const valid = reps.filter((r) => r.validForVolume);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((sum, r) => sum + componentScore(key, config, r), 0) / valid.length);
}

/** 0..100 session-level Correctness Score — the weighted sum feeding Execution Effectiveness. */
export function sessionCorrectnessScore(config: ExerciseConfig, reps: RepResult[]): number {
  const valid = reps.filter((r) => r.validForVolume);
  if (valid.length === 0) return 0;

  let total = 0;
  for (const [key, weight] of Object.entries(config.correctnessWeights)) {
    const value = key === "consistency" ? consistencyScore(valid.map((r) => r.peakExcursionDeg)) : sessionComponentMean(key, config, reps);
    total += weight * value;
  }
  return clampScore(total);
}

/** Per-rep correctness for display/live-feedback purposes (e.g. "low smoothness" cueing) — excludes the
 *  session-only "consistency" term, with the remaining weights renormalized to sum to 1. */
export function perRepCorrectnessScore(config: ExerciseConfig, rep: RepResult): number {
  const entries = Object.entries(config.correctnessWeights).filter(([key]) => key !== "consistency");
  const weightSum = entries.reduce((sum, [, w]) => sum + w, 0);
  if (weightSum <= 0) return 100;
  const total = entries.reduce((sum, [key, w]) => sum + w * componentScore(key, config, rep), 0);
  return clampScore(total / weightSum);
}
