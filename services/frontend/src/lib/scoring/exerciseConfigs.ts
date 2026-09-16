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
};

export function getExerciseConfig(slug: ExerciseSlug): ExerciseConfig {
  return EXERCISE_CONFIGS[slug];
}
