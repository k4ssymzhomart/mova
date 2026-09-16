import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ProxySample,
  type StoredPitchPoint,
  buildStoredProxySeries,
  createPairer,
  createProxyOrienter,
  relativePitchDeg,
} from "./flexion.ts";
import {
  type RepThresholds,
  countOrientedRepetitions,
  countRepetitions,
  createRepCounter,
  heelSlideThresholds,
} from "./reps.ts";

// Regression for the +/-180 seam. Phoenix origin/main's flexion_signal subtracted thigh pitch from shank
// pitch bare, and biomechanics.py used that. A sensor reports its angle in (-180, 180], so when one sits
// near the seam its reading flips from +178 to -178: a real change of 4 degrees becomes a bare
// difference jump of 356, which the counter took as a bend.

const STEP_MS = 20; // 50 Hz, the rate the sessions are configured for
const SHANK_LAG_MS = 6; // independent BLE links do not notify together
const HEEL_SLIDE = heelSlideThresholds({ min_valid_excursion_deg: 22.5 });

/** What a sensor reports for a true angle: folded into (-180, 180], written independently of wrapDeg. */
function reported(angle: number): number {
  const folded = ((((angle + 180) % 360) + 360) % 360) - 180;
  return folded === -180 ? 180 : folded;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

interface Recording {
  thigh: Array<[number, number]>;
  shank: Array<[number, number]>;
}

/** Both sensors at 50 Hz, shank a few ms behind, each reading jittered and folded like the device's. */
function record(durationMs: number, thighTrue: (tMs: number) => number, shankTrue: (tMs: number) => number, seed = 7) {
  const rand = mulberry32(seed);
  const jitter = () => (rand() * 2 - 1) * 0.4;
  const recording: Recording = { thigh: [], shank: [] };
  for (let tMs = 0; tMs < durationMs; tMs += STEP_MS) {
    recording.thigh.push([tMs, reported(thighTrue(tMs) + jitter())]);
    const shankMs = tMs + SHANK_LAG_MS;
    recording.shank.push([shankMs, reported(shankTrue(shankMs) + jitter())]);
  }
  return recording;
}

/** Proxy samples by reading index, with the pitch difference taken either wrapped or bare. */
function proxy(recording: Recording, difference: (thigh: number, shank: number) => number): ProxySample[] {
  return recording.shank.map(([tMs, shank], i) => ({ tMs, value: difference(recording.thigh[i][1], shank) }));
}

const bare = (thigh: number, shank: number) => shank - thigh;

/** The exercise screen's path: every notification through pairer, orienter and live counter. */
function countLive(recording: Recording, thresholds: RepThresholds) {
  const readings = [
    ...recording.thigh.map(([tMs, pitch]) => ({ role: "thigh" as const, tMs, pitch })),
    ...recording.shank.map(([tMs, pitch]) => ({ role: "shank" as const, tMs, pitch })),
  ].sort((a, b) => a.tMs - b.tMs);
  const pairer = createPairer();
  const orienter = createProxyOrienter();
  const counter = createRepCounter(thresholds);
  for (const reading of readings) {
    const pair = pairer.push(reading.role, reading.tMs, reading.pitch);
    if (!pair) continue;
    const value = orienter.push(pair.tMs, pair.relativeDeg);
    if (value !== null) counter.push(pair.tMs, value);
  }
  return { counter, orienter };
}

/** The clinician view's path: stored per-role series, recounted. */
function countStored(recording: Recording, thresholds: RepThresholds) {
  const series = buildStoredProxySeries({
    thigh: recording.thigh as StoredPitchPoint[],
    shank: recording.shank as StoredPitchPoint[],
  });
  return { series, report: countOrientedRepetitions(series.samples, thresholds) };
}

test("a shank resting across the seam is not a rep; the bare difference made phantom reps of it", () => {
  // Thigh at +175. The shank rests at +178 and, for 400 ms every two seconds, settles 3.5 degrees
  // further, past +180, where it reports about -178.5.
  const recording = record(
    12_000,
    () => 175,
    (tMs) => (tMs % 2000 >= 1000 && tMs % 2000 < 1400 ? 181.5 : 178),
  );
  assert.ok(recording.shank.some(([, pitch]) => pitch > 177));
  assert.ok(recording.shank.some(([, pitch]) => pitch < -177));

  // The swing guard is off for both, which is Phoenix origin/main's count_repetitions: the proxy is the
  // only difference between the two calls.
  const unguarded = { maxPlausibleSwingDeg: Number.POSITIVE_INFINITY };
  const phantom = countRepetitions(proxy(recording, bare), unguarded);
  assert.ok(phantom.count >= 1, "the bare difference must count the seam flips, or this test proves nothing");
  assert.equal(phantom.count, 6);
  assert.equal(countRepetitions(proxy(recording, relativePitchDeg), unguarded).count, 0);

  const wrapped = countRepetitions(proxy(recording, relativePitchDeg));
  assert.equal(wrapped.count, 0);
  assert.equal(wrapped.reason, "no_excursion_detected");
  assert.ok(wrapped.amplitude < 8);

  for (const thresholds of [{ enterDeg: 18, exitDeg: 7, minRepMs: 250 }, HEEL_SLIDE]) {
    assert.equal(countLive(recording, thresholds).counter.count, 0);
    assert.equal(countStored(recording, thresholds).report.count, 0);
  }
});

test("real reps that carry the shank across the seam count correctly", () => {
  // Ten heel slides. Thigh at +175, shank rests at +178 and turns 60 degrees further each rep, so it
  // reports past +180 as -122 at the peak.
  const cycleMs = 5500;
  const shankTrue = (tMs: number) => {
    const t = tMs - 1000;
    if (t < 0 || t >= 10 * cycleMs) return 178;
    const phase = t % cycleMs;
    if (phase < 3000) return 178;
    if (phase < 4000) return 178 + 60 * ease((phase - 3000) / 1000);
    if (phase < 4300) return 238;
    if (phase < 5300) return 238 - 60 * ease((phase - 4300) / 1000);
    return 178;
  };
  const recording = record(1000 + 10 * cycleMs + 1000, () => 175, shankTrue, 21);
  assert.ok(recording.shank.some(([, pitch]) => pitch < -120));

  const batch = countRepetitions(proxy(recording, relativePitchDeg), HEEL_SLIDE);
  assert.equal(batch.count, 10);
  assert.ok(Math.abs(batch.amplitude - 60) < 2);

  const live = countLive(recording, HEEL_SLIDE);
  assert.equal(live.counter.count, 10);
  assert.equal(live.orienter.orientation, 1);

  const stored = countStored(recording, HEEL_SLIDE);
  assert.equal(stored.report.count, 10);
  assert.ok(Math.abs(stored.report.amplitude - 60) < 2);
  assert.equal(stored.series.pairing.unpairedShank, 0);
  assert.equal(stored.series.pairing.maxSkewMs, SHANK_LAG_MS);
  for (const segment of stored.report.segments) assert.ok(segment.peakValue > 55 && segment.peakValue < 65);

  // Phoenix's current branch guards the swing instead of wrapping: the bare difference of this session
  // swings about 300 degrees, so the guard would have thrown away all ten real reps.
  const guarded = countRepetitions(proxy(recording, bare), HEEL_SLIDE);
  assert.equal(guarded.count, 0);
  assert.equal(guarded.reason, "implausible_swing");
});

test("a thigh flickering across the seam does not disturb reps bending the other way", () => {
  // The thigh sits right on +/-180 and its reading flips sign from sample to sample. The shank rests at
  // +176 and bends 70 degrees down, so the raw difference falls and the orientation must come out -1.
  const cycleMs = 5000;
  const shankTrue = (tMs: number) => {
    const t = tMs - 1000;
    if (t < 0 || t >= 8 * cycleMs) return 176;
    const phase = t % cycleMs;
    if (phase < 2600) return 176;
    if (phase < 3600) return 176 - 70 * ease((phase - 2600) / 1000);
    if (phase < 3900) return 106;
    if (phase < 4900) return 106 + 70 * ease((phase - 3900) / 1000);
    return 176;
  };
  const recording = record(1000 + 8 * cycleMs + 1000, () => 180, shankTrue, 33);
  assert.ok(recording.thigh.filter(([, pitch]) => pitch > 0).length > 100);
  assert.ok(recording.thigh.filter(([, pitch]) => pitch < 0).length > 100);

  assert.equal(countRepetitions(proxy(recording, relativePitchDeg), HEEL_SLIDE).count, 8);
  const live = countLive(recording, HEEL_SLIDE);
  assert.equal(live.counter.count, 8);
  assert.equal(live.orienter.orientation, -1);
  const stored = countStored(recording, HEEL_SLIDE);
  assert.equal(stored.report.count, 8);
  assert.equal(stored.series.orientation, -1);
  assert.ok(Math.abs(stored.report.amplitude - 70) < 2);
});
