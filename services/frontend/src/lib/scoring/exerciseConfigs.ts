// The 8 exercise configs, verbatim from docs/PHOENIX_8_Exercises_Targets (1).docx §3/§4/§11. Hardcoded
// TS rather than a Supabase table — see the plan's reasoning: the formulas themselves (band tables,
// weighted sub-scores) are logic, not just numeric knobs, so a table would only hold half the picture
// and risk drifting out of sync with the code that interprets it. Keyed by exercises.slug so it joins
// against the real exercise catalog at runtime.
//
// tempoRangeSec is NOT given numerically anywhere in the spec (it only says a config needs
// tempo_min/tempo_max, §11.1) — the values below are provisional PT-plausible defaults, same
// "needs validation" caveat lib/ble/signalQuality.ts already carries for its own thresholds.

import type { ExerciseConfig, ExerciseSlug } from "./types";

export const EXERCISE_CONFIGS: Record<ExerciseSlug, ExerciseConfig> = {
  heel_slide: {
    slug: "heel_slide",
    nameRu: "Скольжение пятки",
    targetType: "at_least",
    targetValueDeg: 90,
    minValidExcursionDeg: 22.5, // max(15, 25% * 90)
    tempoRangeSec: [3, 8],
    correctnessWeights: { smoothness: 0.3, tempo: 0.25, controlledReturn: 0.2, consistency: 0.15, hold: 0.1 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  seated_knee_flexion: {
    slug: "seated_knee_flexion",
    nameRu: "Сгибание колена сидя",
    targetType: "at_least",
    targetValueDeg: 90,
    minValidExcursionDeg: 22.5,
    tempoRangeSec: [3, 8],
    correctnessWeights: { smoothness: 0.3, tempo: 0.25, hold: 0.2, controlledReturn: 0.15, consistency: 0.1 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  prone_knee_bend: {
    slug: "prone_knee_bend",
    nameRu: "Сгибание колена лёжа на животе",
    targetType: "at_least",
    targetValueDeg: 90,
    minValidExcursionDeg: 22.5,
    tempoRangeSec: [3, 8],
    correctnessWeights: { smoothness: 0.3, tempo: 0.25, controlledReturn: 0.2, hold: 0.15, consistency: 0.1 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  short_arc_quad: {
    slug: "short_arc_quad",
    nameRu: "Разгибание колена с валиком",
    targetType: "at_most_deficit",
    // "Target" here is the final flexion deficit, not an absolute angle — final knee angle should be
    // <=5deg flexion. The actual target EXCURSION (theta_start - 5) is calibration-dependent and
    // computed at runtime; this default min-valid-excursion (10deg) is the spec's own floor
    // (max(10, 25% * target_excursion)) before a real calibration baseline is known.
    targetValueDeg: 5,
    minValidExcursionDeg: 10,
    tempoRangeSec: [2, 6],
    correctnessWeights: { smoothness: 0.25, tempo: 0.2, extensionControl: 0.25, hold: 0.15, controlledReturn: 0.15 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  straight_leg_raise: {
    slug: "straight_leg_raise",
    nameRu: "Подъём прямой ноги",
    targetType: "at_least",
    targetValueDeg: 30, // thigh elevation; knee extension lag <=10deg is the secondary subscore
    minValidExcursionDeg: 10,
    tempoRangeSec: [3, 8],
    correctnessWeights: { smoothRise: 0.25, tempo: 0.2, hold: 0.2, controlledLowering: 0.2, kneeStability: 0.15 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  ankle_pumps: {
    slug: "ankle_pumps",
    nameRu: "Насос стопой",
    targetType: "at_least",
    targetValueDeg: 20, // total plantarflexion<->dorsiflexion excursion per cycle
    minValidExcursionDeg: 8,
    tempoRangeSec: [1.5, 4],
    correctnessWeights: { cycleCompleteness: 0.3, tempo: 0.25, smoothness: 0.25, consistency: 0.2 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["shank", "foot"],
    prescribedRepsDefault: 15,
  },
  mini_squat: {
    slug: "mini_squat",
    nameRu: "Мини-присед",
    targetType: "band",
    targetValueDeg: 30, // center of the 25-35deg target band
    minValidExcursionDeg: 10,
    tempoRangeSec: [2, 6],
    correctnessWeights: { downUpSmoothness: 0.3, tempo: 0.25, bottomControl: 0.2, return: 0.15, consistency: 0.1 },
    targetScoreBands: [
      { minDeg: 25, maxDeg: 35, score: 100 },
      { minDeg: 20, maxDeg: 24, score: 80 },
      { minDeg: 36, maxDeg: 40, score: 80 },
      { minDeg: 15, maxDeg: 19, score: 60 },
      { minDeg: 41, maxDeg: 45, score: 60 },
      { minDeg: 10, maxDeg: 14, score: 40 },
    ],
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  quad_set: {
    slug: "quad_set",
    nameRu: "Изометрическое напряжение квадрицепса",
    targetType: "hold",
    targetValueDeg: null, // no ROM target — this is a static hold; see holdTargetSec instead
    minValidExcursionDeg: 0, // static exercise, per spec: "Не применяется"
    holdTargetSec: 5,
    tempoRangeSec: [4, 15], // loose "whole attempt" window; tempo isn't the primary signal here
    correctnessWeights: { timing: 0.4, stability: 0.4, consistency: 0.2 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },

  // — from the PHOENIX profiles ———————————————————————————————————————————————————————————————————
  // The five below come from PHOENIX's exercise_signals.py (signal + minimum valid excursion) and
  // execution_score.py (targets and correctness weights), vendored into services/imu-tools.
  //
  // Two rules were followed translating them, and both matter more than the numbers:
  //
  //  * A POINT target transfers, a RANGE target does not. PHOENIX calibrates tempo as a single mean
  //    duration from good reference takes, and for four of these five it has no calibration at all
  //    ("no reference recordings yet"). mova's tempoRangeSec is a [min, max] window, and deriving a
  //    window from a point — or from nothing — would invent the very number PHOENIX left empty. So
  //    every one of these carries tempoRangeSec: null, and the tempo and controlled-return
  //    sub-scores abstain and redistribute their weight (correctnessScore.ts). holdTargetSec IS a
  //    point target in both systems, so it transfers directly where PHOENIX has one.
  //  * Weights are PHOENIX's, renormalized to sum to 1 as this type requires. PHOENIX's own weights
  //    sum to 85–95 because it divides by the weight it actually used; mova now does the same thing
  //    through abstention, so the two agree on which components count.
  //
  // prescribedRepsDefault is not in PHOENIX; it follows mova's own convention (10, or 15 for ankle
  // work) and is provisional like the rest of the doses here.
  ball_knee_flexion: {
    slug: "ball_knee_flexion",
    nameRu: "Сгибание колена с мячом",
    targetType: "at_least",
    targetValueDeg: 90,
    minValidExcursionDeg: 22.5, // PHOENIX enter_deg; max(15, 25% * 90)
    tempoRangeSec: null, // PHOENIX: no reference recordings yet
    correctnessWeights: { smoothness: 0.34, tempo: 0.28, controlledReturn: 0.22, consistency: 0.16 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  heel_slide_with_band: {
    slug: "heel_slide_with_band",
    nameRu: "Скольжение пятки с лентой",
    targetType: "at_least",
    targetValueDeg: 90, // PHOENIX reuses heel slide's target unchanged — confirm clinically
    minValidExcursionDeg: 22.5,
    tempoRangeSec: null,
    correctnessWeights: { smoothness: 0.34, tempo: 0.28, controlledReturn: 0.22, consistency: 0.16 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  supported_knee_raise: {
    slug: "supported_knee_raise",
    nameRu: "Подъём колена с поддержкой",
    targetType: "at_least",
    targetValueDeg: 60,
    minValidExcursionDeg: 15,
    holdTargetSec: 0.5, // PHOENIX top_hold, a real point target
    tempoRangeSec: null,
    correctnessWeights: { smoothness: 0.32, tempo: 0.26, controlledReturn: 0.21, hold: 0.21 },
    signalConfidenceMin: "MEDIUM",
    // The knee angle is thigh-to-shank; the foot sensor is worn (catalog.ts lists it, per PHOENIX's
    // 0023) but is not part of the primary angle.
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  seated_knee_extension: {
    slug: "seated_knee_extension",
    nameRu: "Разгибание колена сидя",
    targetType: "at_least",
    // The movement is extension from the seated ~90deg rest: a final knee angle within 10deg of
    // straight is an ~80deg excursion. PHOENIX notes the ~90deg rest is assumed, since the sensors
    // give relative pitch and not an absolute knee angle.
    targetValueDeg: 80,
    minValidExcursionDeg: 20, // PHOENIX enter_deg; max(15, 25% * 80)
    holdTargetSec: 0.8, // calibrated from PHOENIX's good reference reps
    // PHOENIX calibrated tempo 1.2 s and controlled return 1.1 s from reference takes — the only one
    // of these five with real tempo numbers. They are still null here because they are point means
    // and this field is a window; deriving a width would be the invention. Worth revisiting with the
    // reference takes in hand, which is the one case here where the data to do it properly exists.
    tempoRangeSec: null,
    correctnessWeights: { smoothness: 0.33, tempo: 0.28, hold: 0.22, controlledReturn: 0.17 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["thigh", "shank"],
    prescribedRepsDefault: 10,
  },
  resisted_ankle_pump: {
    slug: "resisted_ankle_pump",
    nameRu: "Движения стопой с сопротивлением",
    targetType: "at_least",
    // PHOENIX prescribes complete cycles and sets no ROM target, but a null target here scores 0 on
    // Target (targetScore.ts) rather than abstaining, which would hold this exercise down by 30% of
    // its Execution Score for having nothing measured. So the target and minimum excursion follow
    // mova's OWN ankle-pumps entry -- the same ankle movement, with a band added -- rather than
    // being invented or left to score zero. Clinical confirmation is listed in the pull request.
    targetValueDeg: 20,
    minValidExcursionDeg: 8,
    tempoRangeSec: null,
    correctnessWeights: { cycleCompleteness: 0.3, tempo: 0.25, smoothness: 0.25, consistency: 0.2 },
    signalConfidenceMin: "MEDIUM",
    primarySensorRoles: ["shank", "foot"],
    prescribedRepsDefault: 15,
  },
};

export function getExerciseConfig(slug: ExerciseSlug): ExerciseConfig {
  return EXERCISE_CONFIGS[slug];
}
