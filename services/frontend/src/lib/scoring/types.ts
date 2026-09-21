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
  | "quad_set"
  // From the PHOENIX signal/execution profiles rather than the docx — see exerciseConfigs.ts.
  // These slugs are snake_case like the rest; lib/exercises/ids.ts maps them to the kebab-case
  // catalog slugs, which are the canonical ones.
  | "ball_knee_flexion"
  | "heel_slide_with_band"
  | "supported_knee_raise"
  | "seated_knee_extension"
  | "resisted_ankle_pump"
  // The two PHOENIX profiles that had no mova exercise at all until the catalog gained them —
  // services/imu-tools/exercise_ids.json listed both under phoenix_unmapped.ids. Their configs live in
  // exerciseConfigs.ts, which is owned by another change in this build: until that lands, EXERCISE_CONFIGS
  // (a Record<ExerciseSlug, ExerciseConfig>) is missing these two keys and the typecheck says so, which is
  // the correct order — the union is the contract and the table has to satisfy it.
  | "lying_partial_leg_raise"
  | "lying_partial_leg_hold";

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
  /** [min, max] seconds a well-paced rep should take; drives tempoScore and the "too fast" cue.
   *  null means NOT CALIBRATED for this exercise — PHOENIX leaves the tempo target empty until a
   *  reference take exists, and inventing a plausible range here would turn "we have not measured
   *  this" into a number the patient is scored against. The tempo and controlled-return sub-scores
   *  then abstain and their weight is redistributed over the rest (correctnessScore.ts), which is
   *  what PHOENIX's own rep_correctness does via its used_weight. repDetector still needs a
   *  mechanical abandon timeout and falls back to a documented default. */
  tempoRangeSec: [number, number] | null;
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

/** One scored component, together with an explicit record of what went into it.
 *
 *  `score === null` is the whole point of this type: it means NOTHING was measured. It is never 0 and
 *  never 100, because both of those are grades — 0 fails the patient for something nobody looked at,
 *  100 rewards them for it. This is the shape PHOENIX already uses: services/imu-tools/src/mova_imu/
 *  analysis/execution_score.py:216-218 returns {"score": None, "reason": "no_calibrated_metrics"} in
 *  exactly this situation rather than a number. */
export interface ComponentScore {
  /** 0..100 over the sub-components that were measured, or null when none of them were. */
  score: number | null;
  /** Sub-component keys that produced a number, in the order the config declares them. */
  measured: string[];
  /** Sub-component keys that abstained — no calibrated target for this exercise, or no data in the
   *  rep. The UI must name these to the patient; a score computed from half its declared components
   *  is not the same thing as a score, and hiding that is how a guess becomes a fact. */
  abstained: string[];
  /** Sum of the DECLARED weights that actually contributed, 0..1. 1 means everything the config asked
   *  for was measured; 0 means nothing was and `score` is null. Anything between is a partial
   *  measurement that the caller is expected to disclose rather than round away. */
  weightUsed: number;
}

/** The names the session rollup weighs. */
export type ExecutionComponentName = "correctness" | "volume" | "target";

/** The session rollup, with the weight redistribution made visible instead of hidden inside one integer.
 *  Port of assess_execution's return shape (execution_score.py:304-323), whose `components_used` this
 *  mirrors field for field. */
export interface ExecutionResult {
  /** 0..100, or null when not one component could be scored. */
  score: number | null;
  /** The weight each component actually carried AFTER the abstaining ones were dropped and the rest
   *  renormalised. A missing key means that component abstained. These sum to 1 whenever `score` is
   *  not null. */
  componentsUsed: Partial<Record<ExecutionComponentName, number>>;
  /** Components that carried no weight because nothing was measured for them. */
  abstained: ExecutionComponentName[];
}

export interface SessionResult {
  exerciseSlug: ExerciseSlug;
  reps: RepResult[];
  prescribedReps: number;
  /** 0..100, min(valid_reps/prescribed_reps, 1) × 100. Null when nothing was prescribed, because a
   *  session with no prescription has no volume to be a fraction of (execution_score.py:250-251 calls
   *  this "no_prescribed_reps"). */
  volumeScore: number | null;
  /** Session-mean of each valid rep's per-rep target score, or an abstention when the exercise has no
   *  configured target or no valid rep to read one from. */
  targetScore: ComponentScore;
  /** Weighted session technique score, plus which technique components were actually measured. */
  correctnessScore: ComponentScore;
  /** 0.50×correctness + 0.20×volume + 0.30×target (spec §2), renormalised over whichever of the three
   *  were measured. `execution.componentsUsed` reports the weights that were really applied. */
  execution: ExecutionResult;
  /** Provisional — relative angle, not a clinically-calibrated absolute ROM. */
  romMaxDeg: number | null;
  romMeanDeg: number | null;
  targetReachedCount: number;
  /** True if scoring was ever gated off (signal quality/sync/sensor loss) at any point in the session —
   *  the UI must show the specific problem instead of a stale number when this is true (spec §9.3). */
  frozen: boolean;
  frozenReasons: string[];
}
