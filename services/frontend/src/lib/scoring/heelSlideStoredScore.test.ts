import { describe, expect, it } from "vitest";

import type { StoredPitchPoint } from "@/lib/motion/flexion";

import { EXERCISE_CONFIGS } from "./exerciseConfigs";
import { buildHeelSlideSessionResult, type StoredQualitySample } from "./heelSlideStoredScore";

// Synthetic stored thigh/shank pitch series, built the same way recount.test.ts builds them for the
// clinician recount: thigh held flat so shank pitch alone IS the shank-minus-thigh proxy, a flat run at the
// start for buildStoredProxySeries' baseline (no baselineWindow given here, so it zeroes on the first
// PROXY_BASELINE_MS of pairs), then N clean rise-hold-fall-rest cycles.

const STEP_MS = 50; // 20 Hz
const BASELINE_MS = 600; // clears PROXY_BASELINE_MS (500ms) with margin
const RISE_MS = 300;
const HOLD_MS = 100;
const FALL_MS = 300;
const REST_MS = 300;
const CYCLE_MS = RISE_MS + HOLD_MS + FALL_MS + REST_MS;

function repShankPitch(tSinceBaselineMs: number, peakDeg: number, reps: number): number {
  if (tSinceBaselineMs < 0 || tSinceBaselineMs >= reps * CYCLE_MS) return 0;
  const phase = tSinceBaselineMs % CYCLE_MS;
  if (phase < RISE_MS) return peakDeg * (phase / RISE_MS);
  if (phase < RISE_MS + HOLD_MS) return peakDeg;
  if (phase < RISE_MS + HOLD_MS + FALL_MS) return peakDeg * (1 - (phase - RISE_MS - HOLD_MS) / FALL_MS);
  return 0;
}

function buildSeries(peakDeg: number, reps: number): { thigh: StoredPitchPoint[]; shank: StoredPitchPoint[] } {
  const thigh: StoredPitchPoint[] = [];
  const shank: StoredPitchPoint[] = [];
  const totalMs = BASELINE_MS + reps * CYCLE_MS + 500;
  for (let tMs = 0; tMs < totalMs; tMs += STEP_MS) {
    thigh.push([tMs, 0]);
    shank.push([tMs, repShankPitch(tMs - BASELINE_MS, peakDeg, reps)]);
  }
  return { thigh, shank };
}

/** HIGH-quality (1.0) samples for the whole span, at the same cadence as the pitch series. */
function goodQuality(totalMs: number): StoredQualitySample[] {
  const samples: StoredQualitySample[] = [];
  for (let tMs = 0; tMs < totalMs; tMs += STEP_MS) samples.push({ tMs, quality: 1 });
  return samples;
}

const config = EXERCISE_CONFIGS.heel_slide;
const rubric = { min_valid_excursion_deg: 22.5 };

describe("buildHeelSlideSessionResult — clean session", () => {
  it("10 clean reps to 90deg, prescribed 10: full valid reps, Volume 100, frozen false", () => {
    const reps = 10;
    const series = buildSeries(90, reps);
    const totalMs = BASELINE_MS + reps * CYCLE_MS + 500;
    const score = buildHeelSlideSessionResult({
      config,
      series,
      qualitySamples: goodQuality(totalMs),
      prescribedReps: 10,
      rubric,
    });

    expect(score.result.reps).toHaveLength(reps);
    expect(score.result.reps.every((r) => r.validForVolume)).toBe(true);
    expect(score.result.volumeScore).toBe(100);
    expect(score.result.targetScore).toBeGreaterThanOrEqual(95); // peaks land at/near 90deg
    expect(score.result.frozen).toBe(false);
    expect(score.result.frozenReasons).toEqual([]);
    expect(score.algorithmVersion).toBeTruthy();
    expect(score.scoreVersion).toBeTruthy();
    expect(score.scoreCapReason).toBeNull(); // spec §15's cap is deliberately unimplemented — see executionScore.ts
  });

  it("12 reps against a prescription of 10: Volume stays capped at 100, not >100 (spec §7, checklist #5)", () => {
    const reps = 12;
    const series = buildSeries(90, reps);
    const totalMs = BASELINE_MS + reps * CYCLE_MS + 500;
    const score = buildHeelSlideSessionResult({
      config,
      series,
      qualitySamples: goodQuality(totalMs),
      prescribedReps: 10,
      rubric,
    });

    expect(score.result.reps).toHaveLength(12);
    expect(score.result.volumeScore).toBe(100);
  });
});

describe("buildHeelSlideSessionResult — signal quality gating (checklist #1)", () => {
  it("a rep recorded entirely under LOW quality is excluded from Volume, and the session is marked frozen", () => {
    const reps = 3;
    const series = buildSeries(90, reps);
    const totalMs = BASELINE_MS + reps * CYCLE_MS + 500;
    const quality = goodQuality(totalMs);

    // Degrade every sample during the second rep's cycle to LOW (0.2 < MEDIUM's 0.6 cutoff).
    const secondRepStart = BASELINE_MS + CYCLE_MS;
    const secondRepEnd = BASELINE_MS + 2 * CYCLE_MS;
    for (const sample of quality) {
      if (sample.tMs >= secondRepStart && sample.tMs < secondRepEnd) sample.quality = 0.2;
    }

    const score = buildHeelSlideSessionResult({
      config,
      series,
      qualitySamples: quality,
      prescribedReps: reps,
      rubric,
    });

    expect(score.result.reps).toHaveLength(3); // still recognised as a rep, just not counted
    const flagged = score.result.reps.filter((r) => !r.validForVolume);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.lossReason).toBe("sensor");
    expect(score.result.volumeScore).toBe(Math.round((2 / 3) * 100));
    expect(score.result.frozen).toBe(true);
    expect(score.result.frozenReasons).toContain("low_signal_confidence");
  });

  it("a quality sample that is still null (before the first evaluation tick) is not treated as low signal", () => {
    const reps = 2;
    const series = buildSeries(90, reps);
    const totalMs = BASELINE_MS + reps * CYCLE_MS + 500;
    // No evaluation ever ran: every sample is null, exactly as session_frames.quality starts out.
    const quality: StoredQualitySample[] = [];
    for (let tMs = 0; tMs < totalMs; tMs += STEP_MS) quality.push({ tMs, quality: null });

    const score = buildHeelSlideSessionResult({ config, series, qualitySamples: quality, prescribedReps: reps, rubric });

    expect(score.result.reps.every((r) => r.validForVolume)).toBe(true);
    expect(score.result.frozen).toBe(false);
  });
});

describe("buildHeelSlideSessionResult — partial movement (checklist #2)", () => {
  it("a rep abandoned mid-rise by a long pause in the data is discarded, not counted", () => {
    const totalMs = BASELINE_MS + CYCLE_MS + 500;
    const thigh: StoredPitchPoint[] = [];
    const shank: StoredPitchPoint[] = [];
    for (let tMs = 0; tMs < totalMs; tMs += STEP_MS) {
      thigh.push([tMs, 0]);
      // A pause: samples stop for over MAX_REP_GAP_MS (1000ms) partway through the first rise, then resume
      // at rest (0) — the open rep this abandons must never appear in the result.
      const inGap = tMs >= BASELINE_MS + 100 && tMs < BASELINE_MS + 100 + 1200;
      if (inGap) continue;
      shank.push([tMs, repShankPitch(tMs - BASELINE_MS, 90, 1)]);
    }
    // thigh must stay paired with whatever shank samples exist; drop thigh's matching gap too so pairing
    // doesn't manufacture samples the shank never sent.
    const shankTimes = new Set(shank.map(([t]) => t));
    const thighFiltered = thigh.filter(([t]) => shankTimes.has(t));

    const score = buildHeelSlideSessionResult({
      config,
      series: { thigh: thighFiltered, shank },
      qualitySamples: goodQuality(totalMs),
      prescribedReps: 1,
      rubric,
    });

    expect(score.result.reps).toHaveLength(0);
    expect(score.result.volumeScore).toBe(0);
  });
});
