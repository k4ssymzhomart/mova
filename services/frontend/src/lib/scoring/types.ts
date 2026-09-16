// Scoring engine types — the data model for turning live BLE joint-angle samples into the patient's
// per-rep and per-session numbers. Verbatim from docs/PHOENIX_8_Exercises_Targets (1).docx §2/§17
// (formulas) and §9.1 (cue ladder); field names match that spec's ExerciseConfig/RepResult/SessionResult
// sketch in §17 where practical. All angle values are RELATIVE, sensor-euler-derived degrees, not
// clinically-calibrated absolute angles (see docs/imu/ble-connectivity.md §3/§9 — physical-unit
// calibration is a separate, not-yet-landed issue) — "provisional" everywhere it reaches the UI.

import type { SensorRole } from "@/lib/ble/roles";
import type { SignalQualityLevel } from "@/lib/ble/signalQuality";

export type ExerciseSlug =
  | "heel_slide"
  | "seated_knee_flexion"
  | "prone_knee_bend"
  | "short_arc_quad"
  | "straight_leg_raise"
  | "ankle_pumps"
  | "mini_squat"
  | "quad_set";

/** How a rep's Target Score is computed. "band" and "hold" exercises use exercise-specific formulas
 *  in targetScore.ts rather than the generic at_least ratio — see that file for the dispatch. */
export type TargetType = "at_least" | "band" | "at_most_deficit" | "hold";

export interface TargetScoreBand {
  /** Inclusive lower bound of peak flexion (deg) for this band. */
  minDeg: number;
  /** Inclusive upper bound; omit for the open-ended top band. */
  maxDeg?: number;
  score: number;
}

/** Weights for correctnessScore.ts's sub-scores. Keys vary per exercise (see exerciseConfigs.ts); the
 *  values for one exercise must sum to 1. */
export type CorrectnessWeights = Record<string, number>;

export interface ExerciseConfig {
  slug: ExerciseSlug;
  /** Patient-facing exercise name, Russian (locale strings will eventually own this; hardcoded for now
   *  same as the rest of this config, per the "hardcoded TS, not a table" decision). */
  nameRu: string;
  targetType: TargetType;
  /** The prescribed target excursion/angle, degrees. Null means "not configured" — targetScore.ts must
   *  render "цель не настроена" rather than inventing 90°, per the spec's explicit edge case (§16). */
  targetValueDeg: number | null;
  minValidExcursionDeg: number;
  /** [min, max] seconds a well-paced rep should take; drives tempoScore and the "too fast" cue. */
  tempoRangeSec: [number, number];
  /** Only for hold-type exercises (Quad Set) or exercises with an explicit end-hold component. */
  holdTargetSec?: number;
  correctnessWeights: CorrectnessWeights;
  /** Only for targetType "band" (Mini Squat). */
  targetScoreBands?: TargetScoreBand[];
  /** Live scoring is gated off (frozen) below this signal-quality level. */
  signalConfidenceMin: Extract<SignalQualityLevel, "MEDIUM" | "HIGH">;
  /** One role = single-sensor angle (relative to that sensor's own calibration baseline). Two roles =
   *  differential angle (first minus second) — the joint-angle proxy for two-sensor exercises. */
  primarySensorRoles: [SensorRole] | [SensorRole, SensorRole];
  prescribedRepsDefault: number;
}

export interface RepResult {
  index: number;
  startedAtMs: number;
  endedAtMs: number;
  /** Peak relative excursion from the calibration baseline reached during this rep, degrees. For
   *  hold-type exercises (Quad Set) this is repurposed as "max deviation from baseline during the
   *  hold" rather than a flexion peak — still "how far did it move," just read differently. */
  peakExcursionDeg: number;
  /** Short Arc Quad only: calibrated start angle (θ_start) and the angle reached at rep end (θ_final) —
   *  its Target Score is (θ_start − θ_final)/(θ_start − 5°) × 100, not a simple excursion ratio. */
  startAngleDeg?: number;
  finalAngleDeg?: number;
  /** Straight Leg Raise only: knee extension lag (deg) at peak elevation — the exercise's Target Score
   *  is 70% elevation + 30% knee-control subscore. */
  secondaryMetricDeg?: number;
  /** Did the rep return to baseline (or reach its defined endpoint) rather than time out. */
  completed: boolean;
  /** Counts toward Volume: completed AND clears minValidExcursionDeg AND not sensor-lost. Target
   *  attainment is irrelevant to this flag — a rep short of target still counts (spec §1, step 3). */
  validForVolume: boolean;
  tempoSec: number;
  /** 0..1, higher = smoother (jerk-derived, see kinematics.ts). */
  smoothness01: number;
  /** Seconds held at/near the endpoint, for exercises with a hold component. */
  holdSec: number;
  /** Seconds spent in the RETURNING phase — feeds controlledReturnScore (an abrupt/dropped return is
   *  much faster than a controlled one). Undefined for reps that never completed a return phase. */
  returnDurationSec?: number;
  /** Never blames the patient: a rep lost to a sensor dropout or sub-threshold signal confidence is
   *  excluded from Volume but is not scored as a failed attempt either (spec §7.1, §16). */
  lossReason: "sensor" | "low_confidence" | null;
}

export type CueCode =
  | "sensor_problem"
  | "rep_incomplete"
  | "target_far"
  | "target_close"
  | "too_fast"
  | "low_smoothness"
  | "all_good";

export interface LiveCue {
  priority: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  code: CueCode;
  repIndex: number;
  emittedAtMs: number;
}

export interface SessionResult {
  exerciseSlug: ExerciseSlug;
  reps: RepResult[];
  prescribedReps: number;
  /** 0..100, min(valid_reps/prescribed_reps, 1) × 100. */
  volumeScore: number;
  /** 0..100, session-mean of each valid rep's per-rep target score. */
  targetScore: number;
  /** 0..100, session-mean of each valid rep's per-rep correctness score. */
  correctnessScore: number;
  /** 0..100, 0.50×correctness + 0.20×volume + 0.30×target — the canonical formula from spec §2. */
  executionEffectiveness: number;
  /** Provisional — relative angle, not a clinically-calibrated absolute ROM. */
  romMaxDeg: number | null;
  romMeanDeg: number | null;
  targetReachedCount: number;
  /** True if scoring was ever gated off (signal quality/sync/sensor loss) at any point in the session —
   *  the UI must show the specific problem instead of a stale number when this is true (spec §9.3). */
  frozen: boolean;
  frozenReasons: string[];
}
