import type { ProxySample } from "./flexion";

/**
 * Repetition counting for the heel slide, on the flexion proxy from flexion.ts: a relative sensor
 * orientation reading, not a knee angle. Nothing here is a score, and the thresholds are engineering
 * defaults, not clinical ones.
 *
 * Port of Phoenix services/api/app/reps.py. A rep is one excursion past `enterDeg` and back past
 * `exitDeg` that lasted at least `minRepMs`; the gap between the two thresholds keeps jitter around
 * either one from counting twice. Differences from the Python:
 *  - The minimum duration is time, not frames. MIN_REP_FRAMES = 5 meant 250 ms at Phoenix's 20 Hz; the
 *    rate here is configured per session and the delivered rate varies, so the 250 ms is what is kept.
 *  - There is one signal (flexion.ts fixes it) instead of an auto-selected pair and axis, so a window
 *    that fails the plausibility check is rejected outright rather than replaced by another candidate.
 *  - A pause in the data ends an open rep without counting it. Phoenix counted windows that were
 *    already assembled; here samples come from Bluetooth links that can stop. When two consecutive
 *    finite samples are more than `maxGapMs` (MAX_REP_GAP_MS) apart, a rep that was open is discarded,
 *    and no new rep starts until the signal has been back at rest (at or below `exitDeg`). So neither the
 *    part of a rep before a pause nor the part after it is counted, and a bend that began during the
 *    pause is not counted either: its start was never seen.
 *  - One state machine. createRepCounter is the live counter and the batch functions run the same
 *    counter, so the count on the patient's screen and a recount from stored frames cannot disagree
 *    about the same oriented samples, the pause rule included. RECENT_COMPLETION_FRAMES is not ported:
 *    the live counter reports the completing sample itself.
 */

export const ENTER_DEG = 18;
export const EXIT_DEG = 7;
export const MIN_REP_MS = 250;
/** Fewer finite samples than this is not a window worth counting. */
export const MIN_SAMPLES = 12;
/** A raw window swinging further than this is not a limb movement (drift, or a seam jump). */
export const MAX_PLAUSIBLE_SWING_DEG = 150;
/**
 * Consecutive samples further apart than this mean the data stopped (a sensor dropped, or thigh and
 * shank could not be paired): a rep open across the pause is discarded rather than counted after it.
 */
export const MAX_REP_GAP_MS = 1000;

export interface RepThresholds {
  enterDeg: number;
  exitDeg: number;
  minRepMs: number;
}

export const DEFAULT_REP_THRESHOLDS: Readonly<RepThresholds> = {
  enterDeg: ENTER_DEG,
  exitDeg: EXIT_DEG,
  minRepMs: MIN_REP_MS,
};

export interface RepCounterOptions extends Partial<RepThresholds> {
  /** A pause longer than this ends an open rep uncounted. Defaults to MAX_REP_GAP_MS; Infinity turns the rule off. */
  maxGapMs?: number;
}

/**
 * Thresholds for Heel Slide from its `exercises.scoring_rubric`. `min_valid_excursion_deg` can only
 * raise the entry threshold: a draft rubric with a small number must not let jitter count as reps.
 * A missing or malformed value falls back to the default.
 *
 * The rubric states that excursion in knee degrees, and it is applied here to the uncalibrated proxy,
 * whose degrees are not knee degrees. Whether a half-range slide stays under it therefore depends on how
 * the sensors sit on the leg; making the two the same unit is calibration's job (#17), not this function's.
 */
export function heelSlideThresholds(rubric: unknown): RepThresholds {
  const declared =
    rubric !== null && typeof rubric === "object"
      ? (rubric as Record<string, unknown>).min_valid_excursion_deg
      : undefined;
  const excursion = typeof declared === "number" && Number.isFinite(declared) ? declared : ENTER_DEG;
  return { enterDeg: Math.max(ENTER_DEG, excursion), exitDeg: EXIT_DEG, minRepMs: MIN_REP_MS };
}

function resolveThresholds(options: Partial<RepThresholds>): RepThresholds {
  const enterDeg = options.enterDeg ?? ENTER_DEG;
  const exitDeg = options.exitDeg ?? EXIT_DEG;
  const minRepMs = options.minRepMs ?? MIN_REP_MS;
  if (!Number.isFinite(enterDeg) || !Number.isFinite(exitDeg) || !(enterDeg > exitDeg)) {
    throw new RangeError("enterDeg must be a finite number greater than exitDeg");
  }
  if (!Number.isFinite(minRepMs) || minRepMs < 0) {
    throw new RangeError("minRepMs must be a finite, non-negative number");
  }
  return { enterDeg, exitDeg, minRepMs };
}

function resolveMaxGapMs(maxGapMs: number | undefined): number {
  const resolved = maxGapMs ?? MAX_REP_GAP_MS;
  if (!(resolved > 0)) throw new RangeError("maxGapMs must be a positive number");
  return resolved;
}

/** One completed excursion. Indices count pushed samples, including skipped non-finite ones. */
export interface RepSegment {
  startIndex: number;
  endIndex: number;
  peakIndex: number;
  startMs: number;
  endMs: number;
  peakMs: number;
  /** Largest proxy value inside the rep, in relative sensor-orientation degrees. */
  peakValue: number;
}

export type RepPhase = "rest" | "flexed";

export interface RepCounterState {
  count: number;
  phase: RepPhase;
  /** True only for the sample that completed a rep. */
  justCompleted: boolean;
  /** True only for the sample that arrived after a pause and so discarded the rep that was open. */
  justCancelled: boolean;
}

export interface RepCounter {
  /** Feed one oriented proxy sample. A non-finite time or value is skipped and does not end a pause. */
  push(tMs: number, orientedValue: number): RepCounterState;
  reset(): void;
  readonly count: number;
  readonly phase: RepPhase;
  /** A copy of the completed reps so far, oldest first. */
  readonly segments: RepSegment[];
  /** Reps discarded because the samples paused for longer than maxGapMs while they were open. */
  readonly cancelled: number;
}

export function createRepCounter(options: RepCounterOptions = {}): RepCounter {
  const { enterDeg, exitDeg, minRepMs } = resolveThresholds(options);
  const maxGapMs = resolveMaxGapMs(options.maxGapMs);
  let index = -1;
  let phase: RepPhase = "rest";
  let startIndex = 0;
  let startMs = 0;
  let peakIndex = 0;
  let peakMs = 0;
  let peakValue = 0;
  let segments: RepSegment[] = [];
  let lastMs: number | null = null;
  // Set by a pause: no rep may start until the signal has been back at rest.
  let awaitingRest = false;
  let cancelled = 0;

  const state = (justCompleted: boolean, justCancelled = false): RepCounterState => ({
    count: segments.length,
    phase,
    justCompleted,
    justCancelled,
  });

  return {
    push(tMs, value) {
      index += 1;
      if (!Number.isFinite(tMs) || !Number.isFinite(value)) return state(false);
      let justCancelled = false;
      if (lastMs !== null && tMs - lastMs > maxGapMs) {
        if (phase === "flexed") {
          phase = "rest";
          cancelled += 1;
          justCancelled = true;
        }
        awaitingRest = true;
      }
      lastMs = tMs;
      if (phase === "rest") {
        if (awaitingRest) {
          if (value <= exitDeg) awaitingRest = false;
        } else if (value >= enterDeg) {
          phase = "flexed";
          startIndex = peakIndex = index;
          startMs = peakMs = tMs;
          peakValue = value;
        }
        return state(false, justCancelled);
      }
      if (value > peakValue) {
        peakIndex = index;
        peakMs = tMs;
        peakValue = value;
      }
      if (value > exitDeg) return state(false);
      phase = "rest";
      // Too quick to be a rep: dropped, not carried into the next excursion.
      if (tMs - startMs < minRepMs) return state(false);
      segments.push({ startIndex, endIndex: index, peakIndex, startMs, endMs: tMs, peakMs, peakValue });
      return state(true);
    },
    reset() {
      index = -1;
      phase = "rest";
      segments = [];
      lastMs = null;
      awaitingRest = false;
      cancelled = 0;
    },
    get count() {
      return segments.length;
    },
    get phase() {
      return phase;
    },
    get segments() {
      return segments.slice();
    },
    get cancelled() {
      return cancelled;
    },
  };
}

export type RepReason = "insufficient_samples" | "no_excursion_detected" | "implausible_swing";

export interface RepReport {
  count: number;
  segments: RepSegment[];
  /** Largest oriented value in the window; 0 when the window was rejected before orienting. */
  amplitude: number;
  reason: RepReason | null;
  /** Reps discarded because the samples paused for longer than maxGapMs while they were open. */
  cancelled: number;
}

export interface CountOptions extends RepCounterOptions {
  maxPlausibleSwingDeg?: number;
}

function finiteValues(samples: readonly ProxySample[]): number[] {
  const values: number[] = [];
  for (const sample of samples) {
    if (Number.isFinite(sample.tMs) && Number.isFinite(sample.value)) values.push(sample.value);
  }
  return values;
}

function rejected(reason: RepReason): RepReport {
  return { count: 0, segments: [], amplitude: 0, reason, cancelled: 0 };
}

function runCounter(samples: readonly ProxySample[], thresholds: RepThresholds, maxGapMs: number): RepReport {
  const counter = createRepCounter({ ...thresholds, maxGapMs });
  let amplitude = -Infinity;
  for (const sample of samples) {
    counter.push(sample.tMs, sample.value);
    if (Number.isFinite(sample.tMs) && sample.value > amplitude) amplitude = sample.value;
  }
  return {
    count: counter.count,
    segments: counter.segments,
    amplitude,
    reason: amplitude >= thresholds.enterDeg ? null : "no_excursion_detected",
    cancelled: counter.cancelled,
  };
}

/**
 * Phoenix's count_repetitions on a raw proxy window (relativePitchDeg values, not yet zeroed): the zero
 * is the window's median and the larger excursion from it is the bend. That assumes a rest-heavy window.
 * The subtraction is plain, as in the Python; wrapping belongs to relativePitchDeg, and a window lying
 * across the +/-180 seam fails the swing check here instead of being unwrapped. Pauses in the sample
 * times end open reps as in createRepCounter.
 */
export function countRepetitions(samples: readonly ProxySample[], options: CountOptions = {}): RepReport {
  const thresholds = resolveThresholds(options);
  const maxGapMs = resolveMaxGapMs(options.maxGapMs);
  const maxSwing = options.maxPlausibleSwingDeg ?? MAX_PLAUSIBLE_SWING_DEG;
  const values = finiteValues(samples);
  if (values.length < MIN_SAMPLES) return rejected("insufficient_samples");

  const sorted = values.slice().sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max - min > maxSwing) return rejected("implausible_swing");
  const middle = Math.floor(sorted.length / 2);
  const baseline = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const sign = max - baseline >= baseline - min ? 1 : -1;

  return runCounter(
    samples.map((sample) => ({ tMs: sample.tMs, value: sign * (sample.value - baseline) })),
    thresholds,
    maxGapMs,
  );
}

/**
 * The same counting on samples that are already oriented, as given: the live orienter's output, or
 * flexion.ts buildStoredProxySeries for a recorded session. No re-zeroing and no swing check, so on
 * identical samples this matches createRepCounter exactly, pauses included.
 */
export function countOrientedRepetitions(samples: readonly ProxySample[], options: RepCounterOptions = {}): RepReport {
  const thresholds = resolveThresholds(options);
  const maxGapMs = resolveMaxGapMs(options.maxGapMs);
  if (finiteValues(samples).length < MIN_SAMPLES) return rejected("insufficient_samples");
  return runCounter(samples, thresholds, maxGapMs);
}
