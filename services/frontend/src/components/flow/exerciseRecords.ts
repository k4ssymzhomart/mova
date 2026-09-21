// What a session of ANY exercise stores about itself — `sessions.summary`, kind `exercise_session.v1`.
//
// Heel Slide already has its own record (heelSlideRecords.ts, kind `heel_slide_path.v1`), which the clinician view
// and the clinician recount are both written against. That record stays exactly as it is and Heel Slide on sensors
// keeps writing it; this one covers every other exercise, and every session run from the camera.
//
// It is a superset of the Heel Slide record, plus the four things that record could take for granted and this one
// cannot:
//
//   exercise_slug   which exercise this was. `heel_slide_path.v1` never needed to say.
//   input_mode      whether the numbers came from sensors on the leg, from the camera, or from the development
//                   simulation. A camera angle and an IMU proxy are not the same measurement and a stored record
//                   that does not say which it was is a record nobody can read later.
//   signal          what the degrees are: which segments, in which order, zeroed how. Heel Slide stores the same
//                   thing as `proxy.definition`; here it has to vary by exercise.
//   score           the execution score with its components — each one a number or null, plus the weight each
//                   actually carried. A component nobody measured is stored as null and as an absent weight,
//                   never as a zero and never as a hundred. This mirrors PHOENIX's `components_used`
//                   (services/imu-tools/src/mova_imu/analysis/execution_score.py, assess_execution).
//
// THE CLINICIAN VIEW DOES NOT READ THIS KIND YET. Migration 0034's `clinician_session_result` recognises only
// `heel_slide_path.v1`, so a session stored under this kind is invisible in the clinician portal until a migration
// teaches it. That is why Heel Slide on sensors is deliberately left on the old kind: losing the one exercise that
// is actually in clinical use would be a worse outcome than a new exercise not appearing yet. It is listed in the
// pull request as the next migration.
//
// As in heelSlideRecords.ts: an unknown value is stored as null, never as a default, and only TYPES are imported
// here, so `npm run test:unit` can run this source directly.

import type { SensorRole } from "@/lib/ble/roles";
import type { RepSegment } from "@/lib/motion/reps";

import type { BaselineWindowRecord } from "./exerciseStatus";
import type { RepSegmentRecord, SummarySensorRecord } from "./heelSlideRecords";

export const EXERCISE_SUMMARY_KIND = "exercise_session.v1";

/**
 * Where the movement was measured.
 *  - sensors:   WT901BLE68 units on the leg. Degrees are the uncalibrated orientation proxy's.
 *  - camera:    MediaPipe pose landmarks from the device camera. Degrees are an image-plane joint angle.
 *  - simulated: the development simulation (lib/ble/simulation.ts). Nobody moved; the program produced the frames.
 */
export type InputMode = "sensors" | "camera" | "simulated";

/** One scored component, as stored. */
export interface ComponentRecord {
  /** 0..100, or null when nothing in this component was measured. Never 0 and never 100 to stand in for null. */
  score: number | null;
  /**
   * The weight this component actually carried in the rollup, after the weight of everything that abstained was
   * redistributed. Null when the component abstained and so carried none.
   */
  weight_used: number | null;
  /** The sub-metrics that were measured, and those that abstained, by name. Lets a reader check the arithmetic. */
  measured: string[];
  abstained: string[];
}

export interface ScoreRecord {
  /** 0..100, or null when not one component could be measured. */
  execution: number | null;
  correctness: ComponentRecord;
  volume: ComponentRecord;
  target: ComponentRecord;
  /**
   * True when at least one component abstained, so a reader knows the execution score was computed from part of the
   * evidence before they compare it with another session's.
   */
  partial: boolean;
}

export interface ExerciseSessionSummary {
  kind: typeof EXERCISE_SUMMARY_KIND;
  /** Canonical kebab-case catalog slug — what public.exercises holds. */
  exercise_slug: string;
  input_mode: InputMode;
  reps_counted_on_device: number;
  target_reps: number | null;
  rep_segments: RepSegmentRecord[];
  /**
   * What the degrees are. `calibrated: false` and `knee_flexion: false` carry the same warning Heel Slide's record
   * does: these are sensor-orientation or image-plane degrees, not a calibrated joint angle.
   */
  signal: { definition: string; calibrated: false; knee_flexion: false; source: InputMode };
  thresholds: { enter_deg: number; exit_deg: number; min_rep_ms: number; max_gap_ms: number | null; source: string };
  baseline_windows_ms: BaselineWindowRecord[];
  baseline_window_ms: BaselineWindowRecord | null;
  restarted_after_reload: boolean;
  /** Null for a camera session: no sensor was bound to a role. */
  sensors: Record<SensorRole, SummarySensorRecord> | null;
  telemetry: {
    frames_confirmed: number | null;
    pending_at_finish: number | null;
    errors: number | null;
    dropped: number | null;
  };
  /** Null when the exercise has no scoring config, so nothing was scored rather than everything scoring zero. */
  score: ScoreRecord | null;
}

function round(value: number | null | undefined, places = 2): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** A counted repetition as the summary stores it. Times are browser receive times, the clock of session_frames. */
export function repSegmentRecord(segment: RepSegment): RepSegmentRecord {
  return {
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    peak_rel_deg: round(segment.peakValue) ?? 0,
  };
}

export interface ComponentInput {
  score: number | null;
  weightUsed?: number | null;
  measured?: readonly string[];
  abstained?: readonly string[];
}

export function componentRecord(input: ComponentInput | null | undefined): ComponentRecord {
  return {
    score: round(input?.score ?? null),
    weight_used: round(input?.weightUsed ?? null, 3),
    measured: [...(input?.measured ?? [])],
    abstained: [...(input?.abstained ?? [])],
  };
}

/**
 * The score as stored. `partial` is true when any component abstained OR when any component reported an abstained
 * sub-metric, because both mean the number was computed from less than the exercise declares.
 */
export function scoreRecord(
  execution: number | null,
  correctness: ComponentInput | null,
  volume: ComponentInput | null,
  target: ComponentInput | null,
): ScoreRecord {
  const components = [componentRecord(correctness), componentRecord(volume), componentRecord(target)];
  return {
    execution: round(execution),
    correctness: components[0],
    volume: components[1],
    target: components[2],
    partial: components.some((component) => component.score === null || component.abstained.length > 0),
  };
}

export interface ExerciseSummaryInput {
  exerciseSlug: string;
  inputMode: InputMode;
  repsCounted: number;
  targetReps: number | null;
  segments: readonly RepSegment[];
  signalDefinition: string;
  thresholds: { enterDeg: number; exitDeg: number; minRepMs: number; source: string };
  maxGapMs: number | null;
  baselineWindows: readonly BaselineWindowRecord[];
  restartedAfterReload: boolean;
  sensors: Record<SensorRole, SummarySensorRecord> | null;
  telemetry: {
    framesConfirmed: number | null;
    pendingAtFinish: number | null;
    errors: number | null;
    dropped: number | null;
  };
  score: ScoreRecord | null;
}

export function buildExerciseSummary(input: ExerciseSummaryInput): ExerciseSessionSummary {
  const windows = [...input.baselineWindows];
  return {
    kind: EXERCISE_SUMMARY_KIND,
    exercise_slug: input.exerciseSlug,
    input_mode: input.inputMode,
    reps_counted_on_device: input.repsCounted,
    target_reps: input.targetReps,
    rep_segments: input.segments.map(repSegmentRecord),
    signal: {
      definition: input.signalDefinition,
      calibrated: false,
      knee_flexion: false,
      source: input.inputMode,
    },
    thresholds: {
      enter_deg: round(input.thresholds.enterDeg) ?? 0,
      exit_deg: round(input.thresholds.exitDeg) ?? 0,
      min_rep_ms: input.thresholds.minRepMs,
      max_gap_ms: input.maxGapMs,
      source: input.thresholds.source,
    },
    baseline_windows_ms: windows,
    baseline_window_ms: windows.length ? windows[windows.length - 1] : null,
    restarted_after_reload: input.restartedAfterReload,
    sensors: input.sensors,
    telemetry: {
      frames_confirmed: input.telemetry.framesConfirmed,
      pending_at_finish: input.telemetry.pendingAtFinish,
      errors: input.telemetry.errors,
      dropped: input.telemetry.dropped,
    },
    score: input.score,
  };
}
