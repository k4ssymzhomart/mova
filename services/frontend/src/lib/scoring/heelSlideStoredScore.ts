// Heel Slide's SessionResult from a finished session's stored frames — the batch counterpart to
// useLiveScoring.ts, run once server-side against session_frames rather than live in the browser (see
// lib/scoring/loadHeelSlideStoredScore.server.ts for why: the same "recompute from the authoritative
// stored record" rule lib/clinic/heelSlideResult.ts already applies to rep counting).
//
// Two things this deliberately does NOT reuse from the rest of lib/scoring, both because Heel Slide's
// real stored data was never shaped for them:
//  - jointAngle.ts / calibration.ts: they expect a live "hold still" CalibrationCapture that Heel Slide's
//    actual exercise screen never performs. Heel Slide's real baseline is lib/motion/flexion.ts's
//    buildStoredProxySeries (per-start median-window zero, already tested against stored data).
//  - repDetector.ts's RepDetector: a different hysteresis FSM from lib/motion/reps.ts's
//    countOrientedRepetitions, the one that actually produced the rep count the patient saw live and the
//    count lib/clinic/heelSlideView.ts already recounts for the clinician. Running a second, never-
//    validated counter here would risk a rep count that disagrees with both of those. Instead, reps.ts's
//    RepSegment[] are the authoritative rep boundaries, and kinematics.ts's generic sub-score helpers
//    (already exercise-agnostic) build each RepResult from a segment's own sample slice — volumeScore.ts /
//    targetScore.ts / correctnessScore.ts / executionScore.ts operate on plain RepResult[] and don't care
//    how it was produced.
//
// The per-start branching below (baselineSource "window" vs "first_samples", one report per start) mirrors
// lib/clinic/heelSlideView.ts's buildHeelSlideView exactly, because that branching IS the definition of "one
// rep count" for a stored Heel Slide session — duplicated here deliberately rather than reused, so a change
// to the well-tested clinician path can't silently change scoring underneath it. Keep the two in sync by
// hand if reps.ts/flexion.ts's contract ever changes.

import { LEVEL_SCORE } from "@/lib/ble/signalQuality";
import {
  buildStoredProxySeries,
  DEFAULT_MAX_PAIR_SKEW_MS,
  type BaselineWindow,
  type ProxySample,
  type StoredPitchPoint,
} from "@/lib/motion/flexion";
import { countOrientedRepetitions, heelSlideThresholds, MAX_REP_GAP_MS, type RepSegment } from "@/lib/motion/reps";

import { sessionCorrectnessScore } from "./correctnessScore";
import { executionEffectiveness } from "./executionScore";
import { smoothness01 } from "./kinematics";
import { sessionTargetScore, targetReachedCount } from "./targetScore";
import type { ExerciseConfig, RepResult, SessionResult } from "./types";
import { volumeScore } from "./volumeScore";

/** exercises.slug in production is the hyphenated form; ExerciseSlug/EXERCISE_CONFIGS use the underscored
 *  one (lib/scoring/types.ts, lib/scoring/exerciseConfigs.ts). 0038_knee_rehab_exercises.sql flags this
 *  same mismatch itself. One explicit mapping, here, rather than assuming either side changes. */
export const HEEL_SLIDE_DB_SLUG = "heel-slide";

/** Bumped when the formulas in correctnessScore.ts/targetScore.ts/volumeScore.ts/executionScore.ts, or the
 *  rep-to-RepResult construction below, change in a way that would score an identical session differently.
 *  Stored on every session_scores row (NTZ AC-10). */
export const SCORING_ALGORITHM_VERSION = "heel-slide-stored-v1";

/** Which revision of the spec this engine implements. Stored alongside algorithm_version so a row always
 *  says which document it was scored against. */
export const SCORE_SPEC_VERSION = "PHOENIX_8_Exercises_Targets(1).docx-2026-09";

/** scoringPermitted's own cutoff (lib/ble/signalQuality.ts: HIGH or MEDIUM only) — a stored frame below
 *  this was recorded while live scoring would have been frozen too. */
const MIN_PERMITTED_QUALITY = LEVEL_SCORE.MEDIUM;

/** A stored frame's signal-quality rollup, time-stamped so it can be matched against a rep's window.
 *  quality mirrors session_frames.quality: LEVEL_SCORE[level], or null before the first evaluation tick. */
export interface StoredQualitySample {
  tMs: number;
  quality: number | null;
}

export interface HeelSlideStoredScoreInput {
  config: ExerciseConfig;
  series: { thigh: readonly StoredPitchPoint[]; shank: readonly StoredPitchPoint[] };
  /** Every stored frame's (recorded_at, quality), any role — quality is session-wide, not per-role
   *  (toFrameRow attaches one rolled-up evaluation to every row). */
  qualitySamples: readonly StoredQualitySample[];
  prescribedReps: number;
  /** exercises.scoring_rubric, passed straight to lib/motion/reps.ts's heelSlideThresholds. */
  rubric: unknown;
  baselineWindow?: BaselineWindow | null;
  baselineWindows?: readonly (BaselineWindow | null | undefined)[] | null;
  maxSkewMs?: number;
}

export interface HeelSlideStoredScore {
  result: SessionResult;
  algorithmVersion: string;
  scoreVersion: string;
  /** Always null: spec §15's worked example implies a further cap beyond the canonical §2 formula, but
   *  gives no formula for it. Guessing one would be exactly the invented number this project exists to
   *  avoid (see executionScore.ts's header) — stays null until the clinical spec owner specifies it. */
  scoreCapReason: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A stored public.session_scores row (0041_session_scores.sql) back to the shape the patient summary and
 * clinician view both render. Shared by lib/scoring/loadHeelSlideStoredScore.server.ts (the patient path,
 * which also writes the row) and lib/clinic/heelSlideResult.ts (the clinician path, read-only) so the two
 * never drift on how a row is interpreted. null for anything that isn't a plausible row — a caller reads
 * that as "not yet scored", never as a fabricated zero score.
 */
export function sessionScoreFromRow(row: unknown): { result: SessionResult; algorithmVersion: string; scoreVersion: string; scoreCapReason: string | null } | null {
  if (!isRecord(row)) return null;
  const reps = Array.isArray(row.reps) ? (row.reps as unknown as RepResult[]) : [];
  const exerciseSlug = row.exercise_slug === "heel_slide" ? "heel_slide" : null;
  if (exerciseSlug === null) return null;

  const result: SessionResult = {
    exerciseSlug,
    reps,
    prescribedReps: Number(row.prescribed_reps) || 0,
    volumeScore: Number(row.volume_score) || 0,
    targetScore: Number(row.target_score) || 0,
    correctnessScore: Number(row.correctness_score) || 0,
    executionEffectiveness: Number(row.execution_effectiveness) || 0,
    romMaxDeg: row.rom_max_deg === null || row.rom_max_deg === undefined ? null : Number(row.rom_max_deg),
    romMeanDeg: row.rom_mean_deg === null || row.rom_mean_deg === undefined ? null : Number(row.rom_mean_deg),
    targetReachedCount: Number(row.target_reached_count) || 0,
    frozen: Boolean(row.frozen),
    frozenReasons: Array.isArray(row.frozen_reasons) ? (row.frozen_reasons as string[]) : [],
  };
  return {
    result,
    algorithmVersion: typeof row.algorithm_version === "string" ? row.algorithm_version : "",
    scoreVersion: typeof row.score_version === "string" ? row.score_version : "",
    scoreCapReason: typeof row.score_cap_reason === "string" ? row.score_cap_reason : null,
  };
}

/** Fraction of the quality samples inside [startMs, endMs] that fall below MIN_PERMITTED_QUALITY. Samples
 *  with quality still null (before the first evaluation tick) are excluded rather than counted either way —
 *  an early startup gap is not evidence the rep itself had bad signal. Zero in-window samples reads as
 *  fully confident: nothing here contradicts the rep counter having accepted the excursion. */
function lowSignalRatio(qualitySamples: readonly StoredQualitySample[], startMs: number, endMs: number): number {
  let total = 0;
  let low = 0;
  for (const sample of qualitySamples) {
    if (sample.tMs < startMs || sample.tMs > endMs || sample.quality === null) continue;
    total += 1;
    if (sample.quality < MIN_PERMITTED_QUALITY) low += 1;
  }
  return total > 0 ? low / total : 0;
}

/** One RepSegment (reps.ts) -> one RepResult, using the same lowSignalRatio > 0.5 -> lossReason "sensor"
 *  cutoff repDetector.ts's live closeRep() applies, so a rep excluded here would have been excluded live
 *  too. completed and "clears the entry threshold" are both true by construction: reps.ts only ever closes
 *  a segment once the proxy has crossed heelSlideThresholds().enterDeg and returned. */
function buildRepResult(
  index: number,
  samples: readonly ProxySample[],
  segment: RepSegment,
  qualitySamples: readonly StoredQualitySample[],
): RepResult {
  const window = samples
    .slice(segment.startIndex, segment.endIndex + 1)
    .map((sample) => ({ tMs: sample.tMs, angleDeg: sample.value }));
  const ratio = lowSignalRatio(qualitySamples, segment.startMs, segment.endMs);
  const lossReason: RepResult["lossReason"] = ratio > 0.5 ? "sensor" : null;

  return {
    index,
    startedAtMs: segment.startMs,
    endedAtMs: segment.endMs,
    peakExcursionDeg: segment.peakValue,
    completed: true,
    validForVolume: lossReason === null,
    tempoSec: (segment.endMs - segment.startMs) / 1000,
    smoothness01: smoothness01(window),
    holdSec: 0, // heel_slide has no holdTargetSec (exerciseConfigs.ts)
    returnDurationSec: (segment.endMs - segment.peakMs) / 1000,
    lossReason,
  };
}

/**
 * Every rep from a finished Heel Slide session's stored frames, in time order across every «Начать» press
 * that took a zero — one RepSegment list per start, exactly as heelSlideView.ts recounts for the clinician,
 * flattened here and renumbered 0..n-1 for RepResult.index.
 */
function buildReps(
  series: { thigh: readonly StoredPitchPoint[]; shank: readonly StoredPitchPoint[] },
  qualitySamples: readonly StoredQualitySample[],
  rubric: unknown,
  options: {
    baselineWindow?: BaselineWindow | null;
    baselineWindows?: readonly (BaselineWindow | null | undefined)[] | null;
    maxSkewMs: number;
  },
): RepResult[] {
  const proxy = buildStoredProxySeries(series, {
    maxSkewMs: options.maxSkewMs,
    baselineWindow: options.baselineWindow,
    baselineWindows: options.baselineWindows,
  });
  const thresholds = heelSlideThresholds(rubric);
  const counting = { ...thresholds, maxGapMs: MAX_REP_GAP_MS };

  // Mirrors heelSlideView.ts's buildHeelSlideView exactly (see this file's header): "window" counts each
  // start on its own zero (a start whose window held no stored pair is skipped, not counted); "first_samples"
  // is one span zeroed on the first stored pairs.
  const spans: Array<{ samples: readonly ProxySample[] } | null> =
    proxy.baselineSource === "window"
      ? proxy.starts.map((start) => (start.baselineDeg === null ? null : { samples: start.samples }))
      : [{ samples: proxy.samples }];

  const reps: RepResult[] = [];
  for (const span of spans) {
    if (span === null) continue;
    const report = countOrientedRepetitions(span.samples, counting);
    for (const segment of report.segments) {
      reps.push(buildRepResult(reps.length, span.samples, segment, qualitySamples));
    }
  }
  return reps;
}

/** True when any evaluated (non-null) quality sample anywhere in the session fell below
 *  MIN_PERMITTED_QUALITY — matches useLiveScoring.ts's "frozen" semantics (scoring was gated off at some
 *  point), computed here from the stored record instead of a live pushSample() call. */
function sessionFrozen(qualitySamples: readonly StoredQualitySample[]): { frozen: boolean; reasons: string[] } {
  const frozen = qualitySamples.some((sample) => sample.quality !== null && sample.quality < MIN_PERMITTED_QUALITY);
  return { frozen, reasons: frozen ? ["low_signal_confidence"] : [] };
}

/** Heel Slide's SessionResult computed once from a finished session's stored frames. Pure: no Supabase, no
 *  server-only import, so this and its formula dependencies are exercised directly by Vitest. */
export function buildHeelSlideSessionResult(input: HeelSlideStoredScoreInput): HeelSlideStoredScore {
  const { config, series, qualitySamples, prescribedReps, rubric } = input;
  const reps = buildReps(series, qualitySamples, rubric, {
    baselineWindow: input.baselineWindow,
    baselineWindows: input.baselineWindows,
    maxSkewMs: input.maxSkewMs ?? DEFAULT_MAX_PAIR_SKEW_MS,
  });

  const vol = volumeScore(reps, prescribedReps);
  const tgt = sessionTargetScore(config, reps);
  const cor = sessionCorrectnessScore(config, reps);
  const validPeaks = reps.filter((r) => r.validForVolume).map((r) => r.peakExcursionDeg);
  const { frozen, reasons } = sessionFrozen(qualitySamples);

  const result: SessionResult = {
    exerciseSlug: config.slug,
    reps,
    prescribedReps,
    volumeScore: vol,
    targetScore: tgt,
    correctnessScore: cor,
    executionEffectiveness: executionEffectiveness(cor, vol, tgt),
    romMaxDeg: validPeaks.length ? Math.max(...validPeaks) : null,
    romMeanDeg: validPeaks.length ? Math.round((validPeaks.reduce((a, b) => a + b, 0) / validPeaks.length) * 10) / 10 : null,
    targetReachedCount: targetReachedCount(config, reps),
    frozen,
    frozenReasons: reasons,
  };

  return {
    result,
    algorithmVersion: SCORING_ALGORITHM_VERSION,
    scoreVersion: SCORE_SPEC_VERSION,
    scoreCapReason: null,
  };
}
