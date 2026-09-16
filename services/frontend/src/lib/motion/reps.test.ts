import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProxySample } from "./flexion.ts";
import {
  DEFAULT_REP_THRESHOLDS,
  MAX_REP_GAP_MS,
  MIN_SAMPLES,
  countOrientedRepetitions,
  countRepetitions,
  createRepCounter,
  heelSlideThresholds,
  type RepThresholds,
} from "./reps.ts";

/**
 * Rest-heavy reps, as in Phoenix's test_reps.py: a flat rest, then a symmetric pulse that ends back at
 * rest. At the default 50 ms step this is Phoenix's 20 Hz.
 */
function cycles(nReps: number, { restFrames = 20, rampFrames = 10, amplitude = 40, dtMs = 50 } = {}): ProxySample[] {
  const samples: ProxySample[] = [];
  let i = 0;
  const add = (value: number) => samples.push({ tMs: i++ * dtMs, value });
  for (let rep = 0; rep < nReps; rep += 1) {
    for (let k = 0; k < restFrames; k += 1) add(0);
    for (let k = 0; k < rampFrames; k += 1) add((amplitude * (k + 1)) / rampFrames);
    for (let k = 0; k < rampFrames; k += 1) add((amplitude * (rampFrames - 1 - k)) / rampFrames);
  }
  return samples;
}

function stream(samples: readonly ProxySample[], thresholds: Partial<RepThresholds> = {}) {
  const counter = createRepCounter(thresholds);
  const states = samples.map((sample) => counter.push(sample.tMs, sample.value));
  return { counter, states };
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

/**
 * A messy oriented session: uneven sample spacing, reps of varied depth and length, blips too short to
 * count, shallow movements that never enter, and dips between the thresholds in the middle of a rep.
 */
function messySession(seed: number, { noise = 2, pauses = false } = {}): ProxySample[] {
  const rand = mulberry32(seed);
  const samples: ProxySample[] = [];
  let tMs = 0;
  const add = (value: number) => {
    tMs += 8 + rand() * 32;
    samples.push({ tMs, value: value + (noise ? (rand() * 2 - 1) * noise : 0) });
  };
  // With `pauses`, the data sometimes stops for 1.1 to 3 s, at rest or mid-movement. Drawn only then, so
  // the sessions without pauses stay exactly as they were.
  const pause = () => {
    tMs += 1100 + rand() * 1900;
  };
  for (let movement = 0; movement < 30; movement += 1) {
    const rest = 30 + Math.floor(rand() * 60);
    for (let k = 0; k < rest; k += 1) add(0);
    if (pauses && rand() < 0.15) pause();
    const kind = rand();
    const peak = kind < 0.25 ? 20 + rand() * 30 : kind < 0.4 ? 5 + rand() * 12 : 25 + rand() * 70;
    const frames = kind < 0.25 ? 2 + Math.floor(rand() * 8) : 10 + Math.floor(rand() * 60);
    const pauseAt = pauses && rand() < 0.4 ? Math.floor(rand() * frames) : -1;
    for (let k = 0; k < frames; k += 1) {
      if (k === pauseAt) pause();
      const phase = k / (frames - 1);
      const dip = kind > 0.85 && phase > 0.4 && phase < 0.6 ? 0.3 : 1;
      add(peak * Math.sin(Math.PI * phase) * dip);
    }
  }
  return samples;
}

test("counts clean cycles", () => {
  const report = countRepetitions(cycles(5));
  assert.equal(report.count, 5);
  assert.ok(report.amplitude > 30);
  assert.equal(report.reason, null);
});

test("the live counter reports a completion on the sample that closes the rep", () => {
  const samples = cycles(3);
  const { counter, states } = stream(samples);
  assert.equal(counter.count, 3);
  const completions = states.flatMap((state, index) => (state.justCompleted ? [index] : []));
  assert.deepEqual(
    completions,
    counter.segments.map((segment) => segment.endIndex),
  );
  assert.equal(states[states.length - 1].phase, "rest");
});

test("a window cut mid-bend counts only the finished reps", () => {
  const samples = cycles(3);
  const cut = samples.slice(0, samples.length - 12);
  assert.equal(countRepetitions(cut).count, 2);
  const { states } = stream(cut);
  const last = states[states.length - 1];
  assert.equal(last.count, 2);
  assert.equal(last.phase, "flexed");
  assert.equal(last.justCompleted, false);
});

test("hysteresis ignores small wobble", () => {
  const samples = Array.from({ length: 200 }, (_, i) => ({ tMs: i * 50, value: 5 * Math.sin(i) }));
  const report = countRepetitions(samples);
  assert.equal(report.count, 0);
  assert.equal(report.reason, "no_excursion_detected");
});

test("a short window is insufficient", () => {
  const report = countRepetitions(cycles(1).slice(0, 8));
  assert.equal(report.count, 0);
  assert.equal(report.reason, "insufficient_samples");
  assert.deepEqual(report.segments, []);
  assert.equal(countOrientedRepetitions(cycles(1).slice(0, MIN_SAMPLES - 1)).reason, "insufficient_samples");
});

test("an implausibly large swing is rejected outright", () => {
  // Phoenix dropped such a candidate and fell back to another axis. The signal here is fixed, so the
  // whole window is refused rather than counted on something else.
  const base = cycles(3);
  const swinging = base.map((sample, i) => ({ tMs: sample.tMs, value: sample.value + 300 * Math.sin(i * 0.3) }));
  const report = countRepetitions(swinging);
  assert.equal(report.count, 0);
  assert.equal(report.reason, "implausible_swing");
  assert.equal(countRepetitions(base).count, 3);
});

test("segments track completions in order", () => {
  const samples = cycles(4);
  const report = countRepetitions(samples);
  assert.equal(report.segments.length, report.count);
  let previousEnd = -1;
  for (const segment of report.segments) {
    assert.ok(segment.startIndex > previousEnd);
    assert.ok(segment.startIndex <= segment.peakIndex && segment.peakIndex <= segment.endIndex);
    assert.ok(segment.startMs <= segment.peakMs && segment.peakMs <= segment.endMs);
    assert.equal(segment.startMs, samples[segment.startIndex].tMs);
    assert.equal(segment.endMs, samples[segment.endIndex].tMs);
    const inside = samples.slice(segment.startIndex, segment.endIndex + 1).map((sample) => sample.value);
    assert.equal(segment.peakValue, Math.max(...inside));
    assert.equal(segment.peakValue, samples[segment.peakIndex].value);
    previousEnd = segment.endIndex;
  }
});

test("the minimum rep duration is time, so the count does not depend on the sample rate", () => {
  // One second up and down, sampled at 20, 50 and 100 Hz.
  const movement = (hz: number, durationMs: number) => {
    const samples: ProxySample[] = [];
    for (let tMs = 0; tMs < 3000; tMs += 1000 / hz) {
      const inRep = tMs >= 1000 && tMs < 1000 + durationMs;
      samples.push({ tMs, value: inRep ? 40 * Math.sin((Math.PI * (tMs - 1000)) / durationMs) : 0 });
    }
    return samples;
  };
  for (const hz of [20, 50, 100]) assert.equal(countOrientedRepetitions(movement(hz, 1000)).count, 1, `${hz} Hz`);
  // 200 ms spans 20 samples at 100 Hz: Phoenix's 5-frame rule would have taken it as a rep.
  assert.equal(countOrientedRepetitions(movement(100, 200)).count, 0);
  assert.equal(countOrientedRepetitions(movement(100, 500)).count, 1);
});

test("a dip between the thresholds does not split a rep", () => {
  const values = [0, 0, 30, 40, 12, 35, 40, 20, 0, 0, 0, 0, 0];
  const report = countOrientedRepetitions(values.map((value, i) => ({ tMs: i * 100, value })));
  assert.equal(report.count, 1);
  assert.equal(report.segments[0].peakIndex, 3);
});

test("thresholds are parameters", () => {
  const samples = cycles(2, { amplitude: 25 });
  assert.equal(countOrientedRepetitions(samples).count, 2);
  const strict = countOrientedRepetitions(samples, { enterDeg: 30 });
  assert.equal(strict.count, 0);
  assert.equal(strict.reason, "no_excursion_detected");
  assert.equal(countOrientedRepetitions(samples, { minRepMs: 5000 }).count, 0);
  assert.throws(() => createRepCounter({ enterDeg: 7, exitDeg: 7 }), RangeError);
  assert.throws(() => countRepetitions(samples, { minRepMs: -1 }), RangeError);
  assert.throws(() => createRepCounter({ enterDeg: Number.NaN }), RangeError);
});

test("heel slide thresholds take the rubric's excursion only when it is stricter", () => {
  assert.deepEqual(heelSlideThresholds({ min_valid_excursion_deg: 22.5 }), {
    enterDeg: 22.5,
    exitDeg: 7,
    minRepMs: 250,
  });
  assert.equal(heelSlideThresholds({ min_valid_excursion_deg: 10 }).enterDeg, 18);
  const unusable = [
    null,
    undefined,
    "x",
    {},
    { min_valid_excursion_deg: "22.5" },
    { min_valid_excursion_deg: Number.NaN },
  ];
  for (const rubric of unusable) {
    assert.deepEqual(heelSlideThresholds(rubric), { ...DEFAULT_REP_THRESHOLDS });
  }
  const shallow = cycles(3, { amplitude: 20 });
  assert.equal(countOrientedRepetitions(shallow).count, 3);
  assert.equal(countOrientedRepetitions(shallow, heelSlideThresholds({ min_valid_excursion_deg: 22.5 })).count, 0);
});

test("oriented counting takes the samples as given; countRepetitions re-zeroes on the median", () => {
  const offset = cycles(3).map((sample) => ({ tMs: sample.tMs, value: sample.value + 10 }));
  assert.equal(countRepetitions(offset).count, 3);
  // Resting at +10 never drops back past the exit threshold, so nothing completes.
  assert.equal(countOrientedRepetitions(offset).count, 0);
});

test("batch and live counting agree on identical oriented input", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const thresholds of [{}, heelSlideThresholds({ min_valid_excursion_deg: 22.5 })]) {
      const samples = messySession(seed);
      const batch = countOrientedRepetitions(samples, thresholds);
      const { counter, states } = stream(samples, thresholds);
      assert.ok(batch.count > 0, `seed ${seed} should contain reps`);
      assert.equal(batch.count, counter.count, `seed ${seed}`);
      assert.deepEqual(batch.segments, counter.segments, `seed ${seed}`);
      assert.equal(states.filter((state) => state.justCompleted).length, batch.count);
    }
  }
});

test("countRepetitions and the live counter agree on identical rest-at-zero input", () => {
  for (const seed of [11, 12, 13, 14]) {
    const samples = messySession(seed, { noise: 0 });
    // Precondition for the median rule to leave the samples unchanged: rest is most of the window.
    assert.ok(samples.filter((sample) => sample.value === 0).length > samples.length / 2);
    const batch = countRepetitions(samples);
    const { counter } = stream(samples);
    assert.ok(batch.count > 0);
    assert.equal(batch.count, counter.count, `seed ${seed}`);
    assert.deepEqual(batch.segments, counter.segments, `seed ${seed}`);
  }
});

test("non-finite samples are skipped without shifting indices", () => {
  const samples = cycles(2);
  samples[5] = { tMs: samples[5].tMs, value: Number.NaN };
  samples[25] = { tMs: Number.NaN, value: 20 };
  const clean = countOrientedRepetitions(cycles(2));
  const report = countOrientedRepetitions(samples);
  assert.equal(report.count, 2);
  assert.equal(report.segments[1].endIndex, clean.segments[1].endIndex);
});

test("a pause longer than maxGapMs discards the open rep instead of counting it after the pause", () => {
  const counter = createRepCounter();
  for (const [tMs, value] of [
    [0, 0],
    [50, 10],
    [100, 30],
    [150, 40],
  ]) {
    counter.push(tMs, value);
  }
  assert.equal(counter.phase, "flexed");
  const resumed = counter.push(150 + MAX_REP_GAP_MS + 1, 3);
  assert.deepEqual(resumed, { count: 0, phase: "rest", justCompleted: false, justCancelled: true });
  assert.equal(counter.cancelled, 1);
  assert.deepEqual(counter.segments, []);
});

test("after a pause the rest of the interrupted bend is not counted, and the next rep is", () => {
  const values = [0, 0, 30, 40, 40, 40, 35, 20, 5, 0, 0, 30, 40, 20, 0, 0];
  // 100 ms apart, with a 1.5 s pause before the sixth sample, while the leg is bent.
  const samples = values.map((value, i) => ({ tMs: i * 100 + (i >= 5 ? 1500 : 0), value }));
  const { counter, states } = stream(samples);
  assert.equal(counter.count, 1);
  assert.equal(counter.cancelled, 1);
  assert.equal(states.findIndex((state) => state.justCancelled), 5);
  assert.equal(states.filter((state) => state.justCancelled).length, 1);
  assert.equal(counter.segments[0].startIndex, 11);
  const batch = countOrientedRepetitions(samples);
  assert.equal(batch.count, 1);
  assert.equal(batch.cancelled, 1);
  assert.deepEqual(batch.segments, counter.segments);
});

test("a bend that began during a pause is not counted: its start was never seen", () => {
  const values = [0, 0, 0, 0, 45, 40, 30, 10, 3, 0, 0, 0];
  const samples = values.map((value, i) => ({ tMs: i * 100 + (i >= 4 ? 2000 : 0), value }));
  const report = countOrientedRepetitions(samples);
  assert.equal(report.count, 0);
  assert.equal(report.cancelled, 0);
  assert.equal(report.reason, null);
  assert.equal(countOrientedRepetitions(samples, { maxGapMs: Number.POSITIVE_INFINITY }).count, 1);
});

test("a gap of exactly maxGapMs is not a pause, and skipped samples do not hide one", () => {
  const exact = createRepCounter({ maxGapMs: 500 });
  exact.push(0, 0);
  exact.push(100, 30);
  exact.push(600, 40);
  assert.equal(exact.push(700, 0).justCompleted, true);

  const skipped = createRepCounter({ maxGapMs: 500 });
  skipped.push(0, 0);
  skipped.push(100, 30);
  skipped.push(400, Number.NaN);
  skipped.push(Number.NaN, 30);
  assert.equal(skipped.push(700, 30).justCancelled, true);
  assert.equal(skipped.cancelled, 1);
});

test("maxGapMs must be positive; Infinity turns the pause rule off", () => {
  for (const maxGapMs of [0, -1, Number.NaN]) {
    assert.throws(() => createRepCounter({ maxGapMs }), RangeError);
    assert.throws(() => countOrientedRepetitions(cycles(1), { maxGapMs }), RangeError);
    assert.throws(() => countRepetitions(cycles(1), { maxGapMs }), RangeError);
  }
  // A 5 s pause halfway up the first rep's ramp.
  const paused = cycles(2).map((sample, i) => ({ tMs: sample.tMs + (i >= 25 ? 5000 : 0), value: sample.value }));
  const report = countOrientedRepetitions(paused);
  assert.equal(report.count, 1);
  assert.equal(report.cancelled, 1);
  assert.equal(countOrientedRepetitions(paused, { maxGapMs: Number.POSITIVE_INFINITY }).count, 2);
  // countRepetitions, on raw values, runs the same counter.
  assert.equal(countRepetitions(paused).count, 1);
  assert.equal(countRepetitions(paused).cancelled, 1);
});

test("batch and live counting agree on identical oriented input with pauses in it", () => {
  let cancelled = 0;
  let withRule = 0;
  let withoutRule = 0;
  for (const seed of [21, 22, 23, 24, 25, 26, 27, 28]) {
    for (const thresholds of [{}, heelSlideThresholds({ min_valid_excursion_deg: 22.5 })]) {
      const samples = messySession(seed, { pauses: true });
      const batch = countOrientedRepetitions(samples, thresholds);
      const { counter, states } = stream(samples, thresholds);
      assert.equal(batch.count, counter.count, `seed ${seed}`);
      assert.deepEqual(batch.segments, counter.segments, `seed ${seed}`);
      assert.equal(batch.cancelled, counter.cancelled, `seed ${seed}`);
      assert.equal(states.filter((state) => state.justCancelled).length, batch.cancelled);
      // No counted rep spans a pause.
      for (const segment of batch.segments) {
        for (let i = segment.startIndex + 1; i <= segment.endIndex; i += 1) {
          assert.ok(samples[i].tMs - samples[i - 1].tMs <= MAX_REP_GAP_MS, `seed ${seed}, rep at ${segment.startMs}`);
        }
      }
      cancelled += batch.cancelled;
      withRule += batch.count;
      withoutRule += countOrientedRepetitions(samples, { ...thresholds, maxGapMs: Number.POSITIVE_INFINITY }).count;
    }
  }
  // The pauses land inside reps often enough for the rule to matter.
  assert.ok(cancelled > 0);
  assert.ok(withoutRule > withRule);
});

test("reset clears the live counter", () => {
  const { counter } = stream(cycles(2));
  assert.equal(counter.count, 2);
  counter.push(10_000, 0);
  counter.push(10_050, 30);
  counter.push(20_000, 30);
  assert.equal(counter.cancelled, 1);
  counter.reset();
  assert.equal(counter.count, 0);
  assert.equal(counter.cancelled, 0);
  assert.equal(counter.phase, "rest");
  assert.deepEqual(counter.segments, []);
  // Neither the last sample's time nor the wait for rest after a pause survives a reset.
  assert.equal(counter.push(30_000, 30).phase, "flexed");
});
