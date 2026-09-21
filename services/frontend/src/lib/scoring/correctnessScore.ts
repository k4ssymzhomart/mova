// Correctness Score — technique, independent of whether the target was reached (spec §1, step 5: "tempo,
// smoothness, контроль возврата, удержание, consistency и доступные IMU-критерии"). Weights per exercise
// come verbatim from the docx (exerciseConfigs.ts); the sub-score MATH is not specified there — see
// kinematics.ts's header for that honesty caveat. "Consistency" is inherently session-level (it compares
// reps to each other), so this computes Correctness at the session level directly — session-mean of each
// per-rep component, plus one consistency term over all valid reps — rather than forcing an artificial
// per-rep consistency value.
//
// The one rule this file now keeps everywhere: a component nobody measured abstains. It never scores 0
// (which fails the patient for something that was never looked at) and never scores 100 (which rewards
// them for it). Both functions below return a ComponentScore, so the caller receives the score AND the
// list of components that produced it — the renormalised number alone is not enough information to show
// a patient, because it looks identical whether it came from five components or from one.
//
// What this file does NOT do: it does not scale the rollup weight by how much of the technique was
// measured. A Correctness computed from half its declared weight still enters executionScore.ts at the
// full 0.50. That is deliberate and matches PHOENIX, and `weightUsed` is what makes it visible rather
// than silent — see executionScore.ts's own note.

import { consistencyScore, controlledReturnScore, holdScore, stabilityScore, tempoScore } from "./kinematics";
import type { ComponentScore, ExerciseConfig, RepResult } from "./types";

const SAQ_EXTENSION_TOLERANCE_DEG = 5;
const SLR_KNEE_STABILITY_TARGET_DEG = 10;
const SLR_KNEE_STABILITY_ZERO_DEG = 30;

/** Consistency compares reps to each other, so one rep cannot produce it. kinematics.ts's
 *  consistencyScore returns 100 for a single rep ("can't judge consistency yet, don't penalize"); this
 *  file treats that same situation as an abstention instead, because a free 100 for an unjudgeable
 *  component is the exact defect this module exists to remove. */
const MIN_REPS_FOR_CONSISTENCY = 2;

/** Every key componentScore knows how to answer. A key outside this list abstains, which is how a typo
 *  in a config's correctnessWeights becomes visible instead of becoming a perfect component — see the
 *  "every component key in every shipped config is recognised" test in correctnessScore.test.ts. */
export const KNOWN_COMPONENT_KEYS = [
  "smoothness",
  "downUpSmoothness",
  "smoothRise",
  "tempo",
  "controlledReturn",
  "controlledLowering",
  "return",
  "hold",
  "timing",
  "stability",
  "kneeStability",
  "extensionControl",
  "cycleCompleteness",
  "bottomControl",
  "consistency",
] as const;

export type KnownComponentKey = (typeof KNOWN_COMPONENT_KEYS)[number];

export function isKnownComponentKey(key: string): key is KnownComponentKey {
  return (KNOWN_COMPONENT_KEYS as readonly string[]).includes(key);
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** One rep's score for one named correctness component, or null when it cannot be scored.
 *
 *  null covers both reasons a component has nothing to say: the exercise has no CALIBRATED target for
 *  it (no tempo window, no hold target), or this particular rep carries no measurement for it (the
 *  detector abandoned the return phase, the Short Arc Quad calibration angles were never supplied).
 *  Either way the component is left out and its weight is redistributed over the ones that did report.
 *  Neither case is a 0 and neither is a 100. */
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
      // A rep with no return phase was not a controlled return and was not an uncontrolled one either:
      // there is no duration to judge, so this abstains rather than handing back a free 100.
      return rep.returnDurationSec !== undefined
        ? controlledReturnScore(rep.returnDurationSec, config.tempoRangeSec)
        : null;
    case "hold":
    case "timing":
      // Five configs weight a hold with no holdTargetSec (heel_slide, seated_knee_flexion,
      // prone_knee_bend, short_arc_quad, straight_leg_raise). Without a target there is no ratio to
      // compute, so the weight goes to the components that do have one. PHOENIX has a calibrated 1.1 s
      // hold target for heel slide (execution_score.py:65) that mova has not adopted; adopting it is a
      // clinical decision and a separate change, not something to paper over with a neutral score.
      return config.holdTargetSec ? holdScore(rep.holdSec, config.holdTargetSec) : null;
    case "stability":
      // Quad Set's own "stability" weight, distinct from kneeStability (SLR) — movement during a hold.
      return stabilityScore(rep.peakExcursionDeg, 5);
    case "kneeStability": {
      // 100 when lag is at/under the 10deg clinical target; falls to 0 by the time lag reaches 30deg.
      // A rep with no knee-lag reading abstains: reading a missing measurement as 0deg of lag would
      // score a perfect knee on a knee nobody watched.
      if (rep.secondaryMetricDeg === undefined) return null;
      const excess = Math.max(0, rep.secondaryMetricDeg - SLR_KNEE_STABILITY_TARGET_DEG);
      return stabilityScore(excess, SLR_KNEE_STABILITY_ZERO_DEG - SLR_KNEE_STABILITY_TARGET_DEG);
    }
    case "extensionControl": {
      // Short Arc Quad: how cleanly the rep reached its own end-point, independent of hitting the
      // <=5deg clinical target — a full, controlled extension attempt scores well even if short of goal.
      // The two angles only exist when useLiveScoring was given its optional
      // calibrationBaselineAbsoluteDeg (repDetector.ts populates them from it), so without that
      // argument this component abstains rather than gifting 0.25 of the exercise's technique score.
      if (rep.startAngleDeg === undefined || rep.finalAngleDeg === undefined) return null;
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
      // An unrecognised key is a config typo. Abstaining makes it show up as an unmeasured component
      // (and fails correctnessScore.test.ts's whitelist check) instead of quietly scoring 100.
      return null;
  }
}

/** Session-mean of one component across valid reps. null when the component abstains for this exercise
 *  or for these reps — see componentScore — and null when there are no valid reps at all, because the
 *  mean of nothing is not zero. */
function sessionComponentMean(key: string, config: ExerciseConfig, reps: RepResult[]): number | null {
  const valid = reps.filter((r) => r.validForVolume);
  if (valid.length === 0) return null;
  let total = 0;
  for (const rep of valid) {
    const value = componentScore(key, config, rep);
    // Abstention is usually a property of the exercise's config rather than of one rep, so the first
    // null settles it for the whole component: a component measured on some reps and not others would
    // otherwise be averaged over a shifting denominator with no record of which reps it covered.
    if (value === null) return null;
    total += value;
  }
  return Math.round(total / valid.length);
}

/** Session-level Correctness, with the components that produced it.
 *
 *  Components that abstain are left out and the remaining weights are renormalised over what was
 *  actually used, so an uncalibrated sub-metric never counts as a zero and never counts as a free 100.
 *  PHOENIX's rep_correctness (execution_score.py:200-220) does the same renormalisation over its
 *  used_weight, and returns None rather than a number when nothing was calibrated.
 *
 *  The two systems are NOT the same table, and this header used to claim they were. They differ in both
 *  directions: PHOENIX has no target for log_dimensionless_jerk in any of its 11 profiles, so smoothness
 *  abstains there while mova always scores it; and PHOENIX has calibrated tempo (1.2 s) and controlled
 *  return (1.1 s) for seated knee extension, which mova nulls out. What is shared is the MECHANISM —
 *  abstain, redistribute, and say so — not the set of components that count. */
export function sessionCorrectnessScore(config: ExerciseConfig, reps: RepResult[]): ComponentScore {
  const valid = reps.filter((r) => r.validForVolume);
  const keys = Object.keys(config.correctnessWeights);
  if (valid.length === 0) {
    // No valid rep means no technique was observed. Every declared component is unmeasured.
    return { score: null, measured: [], abstained: keys, weightUsed: 0 };
  }

  let total = 0;
  let usedWeight = 0;
  const measured: string[] = [];
  const abstained: string[] = [];
  for (const [key, weight] of Object.entries(config.correctnessWeights)) {
    const value =
      key === "consistency"
        ? valid.length < MIN_REPS_FOR_CONSISTENCY
          ? null
          : consistencyScore(valid.map((r) => r.peakExcursionDeg))
        : sessionComponentMean(key, config, reps);
    if (value === null) {
      abstained.push(key);
      continue;
    }
    measured.push(key);
    total += weight * value;
    usedWeight += weight;
  }
  if (usedWeight <= 0) return { score: null, measured, abstained, weightUsed: 0 };
  return { score: clampScore(total / usedWeight), measured, abstained, weightUsed: usedWeight };
}

/** Per-rep correctness for display/live-feedback purposes (e.g. "low smoothness" cueing) — excludes the
 *  session-only "consistency" term, with the remaining weights renormalised over the components that
 *  did not abstain.
 *
 *  This function and sessionCorrectnessScore used to disagree about the all-abstained case: one returned
 *  0 and the other returned 100, seventeen lines apart, for the identical situation. Both now return
 *  score: null. Consistency is skipped rather than listed in `abstained`, because it is not something
 *  one rep could ever have reported. */
export function perRepCorrectnessScore(config: ExerciseConfig, rep: RepResult): ComponentScore {
  let total = 0;
  let usedWeight = 0;
  const measured: string[] = [];
  const abstained: string[] = [];
  for (const [key, weight] of Object.entries(config.correctnessWeights)) {
    if (key === "consistency") continue;
    const value = componentScore(key, config, rep);
    if (value === null) {
      abstained.push(key);
      continue;
    }
    measured.push(key);
    total += weight * value;
    usedWeight += weight;
  }
  if (usedWeight <= 0) return { score: null, measured, abstained, weightUsed: 0 };
  return { score: clampScore(total / usedWeight), measured, abstained, weightUsed: usedWeight };
}
