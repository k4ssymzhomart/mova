import assert from "node:assert/strict";
import test from "node:test";

import { countsTowardVolume, repFeatures, samplesInRep } from "./repFeatures.ts";
import type { RepSegment } from "./reps.ts";

/** A rep that rises to `peak` over `riseMs`, holds it for `holdMs`, then returns over `fallMs`, sampled every 50 ms. */
function trace(peak: number, riseMs: number, holdMs: number, fallMs: number, startMs = 1_000) {
  const samples: { tMs: number; value: number }[] = [];
  for (let t = 0; t <= riseMs; t += 50) samples.push({ tMs: startMs + t, value: (peak * t) / riseMs });
  for (let t = 50; t <= holdMs; t += 50) samples.push({ tMs: startMs + riseMs + t, value: peak });
  for (let t = 50; t <= fallMs; t += 50) {
    samples.push({ tMs: startMs + riseMs + holdMs + t, value: peak * (1 - t / fallMs) });
  }
  const endMs = samples[samples.length - 1].tMs;
  const rep: RepSegment = {
    startIndex: 0,
    endIndex: samples.length - 1,
    peakIndex: Math.round(riseMs / 50),
    startMs,
    endMs,
    peakMs: startMs + riseMs,
    peakValue: peak,
  };
  return { samples, rep };
}

test("tempo is the whole rep, and the peak is the largest value reached", () => {
  const { samples, rep } = trace(90, 1_000, 1_000, 1_000);
  const f = repFeatures(samples, rep);
  assert.equal(f.tempoSec, 3);
  assert.equal(f.peakExcursionDeg, 90);
  assert.equal(f.startedAtMs, rep.startMs);
  assert.equal(f.endedAtMs, rep.endMs);
});

test("the hold is the run at the top, not every high sample in the rep", () => {
  const { samples, rep } = trace(90, 1_000, 2_000, 1_000);
  const f = repFeatures(samples, rep);
  // 2 s of held samples, plus the tail of the rise and the head of the fall that stay inside the 10% band.
  assert.ok(f.holdSec >= 2, `expected at least the 2 s hold, got ${f.holdSec}`);
  assert.ok(f.holdSec < 2.5, `the band must not swallow the whole rep, got ${f.holdSec}`);
});

test("a rep with no pause at the top reports a short hold, not a zero and not an invented one", () => {
  const { samples, rep } = trace(90, 1_000, 0, 1_000);
  const f = repFeatures(samples, rep);
  assert.ok(f.holdSec < 0.5, `a rep that never paused should not report a hold, got ${f.holdSec}`);
});

test("the return is the time from leaving the top to the end of the rep", () => {
  const { samples, rep } = trace(90, 500, 500, 2_000);
  const f = repFeatures(samples, rep);
  assert.ok(f.returnDurationSec !== undefined);
  assert.ok(f.returnDurationSec! > 1.5, `expected roughly the 2 s fall, got ${f.returnDurationSec}`);
});

test("a rep whose samples end at the peak has no return to report, and says undefined rather than zero", () => {
  const samples = [
    { tMs: 1_000, value: 0 },
    { tMs: 1_200, value: 40 },
    { tMs: 1_400, value: 80 },
  ];
  const rep: RepSegment = {
    startIndex: 0,
    endIndex: 2,
    peakIndex: 2,
    startMs: 1_000,
    endMs: 1_400,
    peakMs: 1_400,
    peakValue: 80,
  };
  assert.equal(repFeatures(samples, rep).returnDurationSec, undefined);
});

test("samples outside the rep, and non-finite ones, are left out", () => {
  const rep: RepSegment = {
    startIndex: 0,
    endIndex: 2,
    peakIndex: 1,
    startMs: 1_000,
    endMs: 1_400,
    peakMs: 1_200,
    peakValue: 50,
  };
  const picked = samplesInRep(
    [
      { tMs: 900, value: 5 },
      { tMs: 1_000, value: 0 },
      { tMs: 1_200, value: 50 },
      { tMs: 1_300, value: Number.NaN },
      { tMs: 1_400, value: 10 },
      { tMs: 1_600, value: 0 },
    ],
    rep,
  );
  assert.deepEqual(
    picked.map((s) => s.tMs),
    [1_000, 1_200, 1_400],
  );
});

test("a rep with no samples at all still reports what the segment knows, and holds nothing", () => {
  const rep: RepSegment = {
    startIndex: 0,
    endIndex: 0,
    peakIndex: 0,
    startMs: 1_000,
    endMs: 3_000,
    peakMs: 2_000,
    peakValue: 44,
  };
  const f = repFeatures([], rep);
  assert.equal(f.tempoSec, 2);
  assert.equal(f.peakExcursionDeg, 44);
  assert.equal(f.holdSec, 0);
  assert.equal(f.returnDurationSec, undefined);
  assert.deepEqual(f.samples, []);
});

test("volume counts a rep short of its target, and never counts one lost to a dropout", () => {
  // The spec is explicit that target attainment is irrelevant to Volume (scoring spec §1, step 3).
  assert.equal(countsTowardVolume(30, 22.5, false), true, "a 30-degree rep of a 90-degree exercise still counts");
  assert.equal(countsTowardVolume(20, 22.5, false), false, "under the minimum excursion it is not a repetition");
  assert.equal(countsTowardVolume(90, 22.5, true), false, "a rep lost to a sensor dropout is not counted");
  assert.equal(countsTowardVolume(Number.NaN, 22.5, false), false);
});
