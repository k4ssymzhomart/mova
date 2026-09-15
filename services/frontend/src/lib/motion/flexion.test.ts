import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MAX_PAIR_SKEW_MS,
  FLEXION_PROXY_AXIS,
  PROXY_BASELINE_MS,
  buildStoredProxySeries,
  createPairer,
  createProxyOrienter,
  orientProxySeries,
  proxyPitchDeg,
  relativePitchDeg,
  wrapDeg,
} from "./flexion.ts";

const close = (actual: number | null, expected: number, epsilon = 1e-9) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);

/** Pushes `rest` inside the baseline window, then `movement` after it; returns the movement's outputs. */
function orient(rest: number[], movement: number[]) {
  const orienter = createProxyOrienter();
  const step = PROXY_BASELINE_MS / rest.length;
  rest.forEach((value, i) => assert.equal(orienter.push(i * step, value), null));
  const out = movement.map((value, i) => orienter.push(PROXY_BASELINE_MS + i * 50, value));
  return { orienter, out };
}

test("wrapDeg folds angles into (-180, 180]", () => {
  close(wrapDeg(190), -170);
  close(wrapDeg(-190), 170);
  assert.equal(wrapDeg(180), 180);
  assert.equal(wrapDeg(-180), 180);
  assert.equal(wrapDeg(540), 180);
  assert.equal(wrapDeg(0), 0);
});

test("the proxy axis is pitch, the middle Euler component", () => {
  assert.equal(FLEXION_PROXY_AXIS, 1);
  assert.equal(proxyPitchDeg([10, 20, 30]), 20);
});

test("relativePitchDeg is shank minus thigh, with no gain", () => {
  close(relativePitchDeg(10, 44), 34);
  close(relativePitchDeg(44, 10), -34);
});

test("relativePitchDeg does not jump when the sensors straddle the +/-180 seam", () => {
  // Thigh at +170 and shank at -170 are 20 degrees apart, not -340.
  close(relativePitchDeg(170, -170), 20);
  close(relativePitchDeg(175, -178), 7);
});

test("the orienter holds back until the baseline window has passed", () => {
  const orienter = createProxyOrienter();
  assert.equal(orienter.push(0, 5), null);
  assert.equal(orienter.push(499, 5), null);
  assert.equal(orienter.ready, false);
  assert.equal(orienter.baselineDeg, null);
  close(orienter.push(500, 35), 30);
  assert.equal(orienter.ready, true);
});

test("the zero is the median of the baseline window, so one bad sample does not move it", () => {
  const { orienter, out } = orient([5, 6, 100, 5, 7], [6, 46]);
  assert.equal(orienter.baselineDeg, 6);
  close(out[1], 40);
});

test("a bend reads positive when it drives the raw difference down", () => {
  const { orienter, out } = orient([10, 10], [-20, -50, -80]);
  close(out[2], 90);
  assert.equal(orienter.orientation, -1);
});

test("a bend reads positive when it drives the raw difference up (the other leg or mounting)", () => {
  const { orienter, out } = orient([10, 10], [40, 70, 100]);
  close(out[2], 90);
  assert.equal(orienter.orientation, 1);
});

test("a small wrong-way movement before the real bend does not settle the direction", () => {
  const { out } = orient([0], [6, 3, -30, -70]);
  close(out[3], 70);
});

test("hyperextension after a bend reads negative: nothing is clamped to a knee scale", () => {
  const { out } = orient([0], [-60, -30, 0, 5]);
  close(out[3], -5);
});

test("a large bend is not capped", () => {
  const { out } = orient([0], [150]);
  close(out[0], 150);
});

test("a baseline sitting on the seam zeroes correctly", () => {
  const { orienter, out } = orient([179, -179, 178], [-170]);
  close(orienter.baselineDeg, 179);
  close(out[0], 11);
});

test("reset starts a new baseline window", () => {
  const { orienter } = orient([0], [40]);
  orienter.reset();
  assert.equal(orienter.ready, false);
  assert.equal(orienter.push(10_000, 20), null);
  close(orienter.push(10_000 + PROXY_BASELINE_MS, 50), 30);
});

test("the orienter reports the span its zero was taken over", () => {
  const orienter = createProxyOrienter();
  orienter.push(1000, 5);
  orienter.push(1499, 5);
  assert.equal(orienter.baselineWindow, null);
  orienter.push(1500, 5);
  assert.deepEqual(orienter.baselineWindow, { startMs: 1000, endMs: 1000 + PROXY_BASELINE_MS });
  orienter.reset();
  assert.equal(orienter.baselineWindow, null);
  orienter.push(9000, 5);
  orienter.push(9600, 5);
  assert.deepEqual(orienter.baselineWindow, { startMs: 9000, endMs: 9500 });
});

test("the orienter skips non-finite samples", () => {
  const orienter = createProxyOrienter();
  assert.equal(orienter.push(0, Number.NaN), null);
  assert.equal(orienter.push(Number.NaN, 3), null);
  assert.equal(orienter.ready, false);
});

test("batch orientation matches the live orienter once the direction has settled", () => {
  const samples = [
    ...[0, 100, 200, 300, 400].map((tMs) => ({ tMs, value: 4 })),
    ...[-10, -40, -80, -40, -5, 4, 8, 4].map((value, i) => ({ tMs: 500 + i * 50, value })),
  ];
  const orienter = createProxyOrienter();
  const live = samples.map((sample) => orienter.push(sample.tMs, sample.value));
  const batch = orientProxySeries(samples);
  assert.equal(batch.orientation, -1);
  assert.equal(batch.baselineDeg, 4);
  assert.equal(batch.baselineSampleCount, 5);
  assert.equal(batch.samples.length, samples.length);
  for (let i = 5; i < samples.length; i += 1) close(live[i], batch.samples[i].value);
  // Baseline samples are oriented too in batch form, so a chart can show the whole session.
  assert.equal(batch.samples[0].value, 0);
});

test("batch orientation handles empty, short and non-finite input", () => {
  assert.deepEqual(orientProxySeries([]), { samples: [], baselineDeg: null, orientation: 1, baselineSampleCount: 0 });
  const short = orientProxySeries([
    { tMs: 0, value: 2 },
    { tMs: 100, value: Number.NaN },
    { tMs: 200, value: 4 },
  ]);
  assert.equal(short.samples.length, 2);
  assert.equal(short.baselineDeg, 3);
});

test("the pairer waits for both segments and reports skew", () => {
  const pairer = createPairer();
  assert.equal(DEFAULT_MAX_PAIR_SKEW_MS, 100);
  assert.equal(pairer.push("thigh", 1000, 10), null);
  const pair = pairer.push("shank", 1030, 40);
  assert.ok(pair);
  close(pair.relativeDeg, 30);
  assert.equal(pair.skewMs, 30);
  assert.equal(pair.tMs, 1030);
  // Each new reading of either segment pairs with the other's latest.
  assert.equal(pairer.push("thigh", 1040, 12)?.tMs, 1040);
});

test("the pairer skips readings too far apart", () => {
  const pairer = createPairer(50);
  pairer.push("thigh", 0, 0);
  assert.equal(pairer.push("shank", 51, 20), null);
  assert.equal(pairer.push("thigh", 60, 0)?.skewMs, 9);
});

test("foot readings are not part of the proxy", () => {
  const pairer = createPairer();
  pairer.push("thigh", 0, 0);
  assert.equal(pairer.push("foot", 5, 90), null);
  pairer.reset();
  assert.equal(pairer.push("shank", 10, 20), null);
});

test("stored series pair by nearest timestamp and report skew", () => {
  const thigh = Array.from({ length: 50 }, (_, i) => [i * 20, 0] as const);
  const shank = Array.from({ length: 50 }, (_, i) => [i * 20 + 7, 5] as const);
  const series = buildStoredProxySeries({ thigh, shank });
  assert.deepEqual(series.pairing, {
    thighSamples: 50,
    shankSamples: 50,
    pairs: 50,
    unpairedShank: 0,
    medianSkewMs: 7,
    maxSkewMs: 7,
  });
  assert.equal(series.samples[0].tMs, 7);
  assert.equal(series.baselineDeg, 5);
  assert.ok(series.samples.every((sample) => sample.value === 0));
});

test("stored shank readings with no thigh reading nearby are left out and counted", () => {
  const thigh = [0, 20, 40, 600, 620].map((tMs) => [tMs, 0] as const);
  const shank = [10, 30, 200, 300, 400, 610].map((tMs) => [tMs, 10] as const);
  const series = buildStoredProxySeries({ thigh, shank });
  assert.equal(series.pairing.pairs, 3);
  assert.equal(series.pairing.unpairedShank, 3);
  assert.equal(series.pairing.maxSkewMs, 10);
  // A shank reading halfway between two thigh readings takes the earlier; the pair is timed by the later.
  assert.deepEqual(
    series.samples.map((sample) => sample.tMs),
    [10, 30, 610],
  );
});

test("stored series tolerate unsorted input, missing pitch and a slower thigh sensor", () => {
  const thigh: Array<readonly [number, number | null]> = [
    [40, 0],
    [0, 0],
    [80, null],
    [120, 0],
  ];
  const shank = [0, 20, 40, 60, 100, 120].map((tMs) => [tMs, 3] as const);
  const series = buildStoredProxySeries({ thigh, shank });
  assert.equal(series.pairing.thighSamples, 3);
  assert.equal(series.pairing.pairs, 6);
  assert.equal(series.pairing.maxSkewMs, 20);
});

test("stored series orient by the larger excursion and zero on the first 500 ms", () => {
  const thigh = Array.from({ length: 60 }, (_, i) => [i * 20, 10] as const);
  const pitch = (i: number) => (i < 25 ? 12 : 12 - Math.min(60, (i - 25) * 4));
  const shank = Array.from({ length: 60 }, (_, i) => [i * 20, pitch(i)] as const);
  const series = buildStoredProxySeries({ thigh, shank });
  assert.equal(series.baselineDeg, 2);
  assert.equal(series.orientation, -1);
  close(series.samples[59].value, 60);
});

test("empty stored series produce no samples and unknown skew", () => {
  const series = buildStoredProxySeries({ thigh: [], shank: [] });
  assert.deepEqual(series.samples, []);
  assert.equal(series.baselineDeg, null);
  assert.equal(series.pairing.medianSkewMs, null);
  assert.equal(series.pairing.maxSkewMs, null);
  assert.equal(series.baselineSource, "first_samples");
  assert.deepEqual(series.starts, []);
  assert.deepEqual(series.beforeBaselineWindow, []);
  assert.equal(series.beforeBaselineOwnZero, false);
});

/** Stored thigh and shank read at the same instants, so the stored pairs are exactly the given samples. */
function simultaneous(relative: ReadonlyArray<readonly [number, number]>) {
  return {
    thigh: relative.map(([tMs]) => [tMs, 20] as const),
    shank: relative.map(([tMs, value]) => [tMs, 20 + value] as const),
  };
}

test("a stored recount given the live baseline window zeroes and orients exactly as the live orienter did", () => {
  // An abandoned start resting at 0, then, from 3 s, a new start resting at 8, a bend to 60 and back.
  const relative: Array<[number, number]> = [];
  for (let tMs = 0; tMs < 400; tMs += 20) relative.push([tMs, 0]);
  const restartMs = 3000;
  for (let i = 0; i < 150; i += 1) {
    const bend = i >= 40 && i < 120 ? 52 * Math.sin((Math.PI * (i - 40)) / 80) : 0;
    relative.push([restartMs + i * 20, 8 + bend]);
  }

  // The screen resets the orienter on the new start, so its zero comes from the pairs after 3 s.
  const orienter = createProxyOrienter();
  const live = relative
    .filter(([tMs]) => tMs >= restartMs)
    .map(([tMs, value]) => orienter.push(tMs, relativePitchDeg(20, 20 + value)));
  assert.deepEqual(orienter.baselineWindow, { startMs: restartMs, endMs: restartMs + PROXY_BASELINE_MS });

  const series = buildStoredProxySeries(simultaneous(relative), { baselineWindow: orienter.baselineWindow });
  assert.equal(series.baselineSource, "window");
  assert.equal(series.baselineDeg, orienter.baselineDeg);
  // The window is [start, end): 3000 to 3480 ms, not the sample at 3500.
  assert.equal(series.baselineSampleCount, 25);
  assert.equal(series.orientation, orienter.orientation);
  assert.equal(series.samples.length, live.length);
  live.forEach((value, i) => {
    if (value !== null) assert.equal(series.samples[i].value, value, `sample ${i}`);
  });
  // The abandoned start is kept apart, on the same zero, for drawing.
  assert.equal(series.beforeBaselineWindow.length, 20);
  for (const sample of series.beforeBaselineWindow) close(sample.value, -8);
  assert.equal(series.beforeBaselineOwnZero, false);
  assert.equal(series.pairing.pairs, 170);
  // One start, the same one as the top level; a list of one window gives the same series.
  assert.equal(series.starts.length, 1);
  assert.equal(series.starts[0].pairs, 150);
  assert.deepEqual(series.starts[0].samples, series.samples);
  assert.deepEqual(series.starts[0].uncounted, []);
  assert.deepEqual(buildStoredProxySeries(simultaneous(relative), { baselineWindows: [orienter.baselineWindow] }), series);

  // Without the window the zero would be the abandoned start's.
  assert.equal(buildStoredProxySeries(simultaneous(relative)).baselineDeg, 0);
});

test("a baseline window with no stored pairs inside gives no zero rather than one taken elsewhere", () => {
  const relative = Array.from({ length: 40 }, (_, i) => [i * 20, 5] as const);
  const missing = buildStoredProxySeries(simultaneous(relative), { baselineWindow: { startMs: 5000, endMs: 5500 } });
  assert.equal(missing.baselineSource, "window");
  assert.equal(missing.baselineDeg, null);
  assert.equal(missing.baselineSampleCount, 0);
  assert.deepEqual(missing.samples, []);
  assert.equal(missing.pairing.pairs, 40);
  assert.deepEqual(
    missing.starts.map((start) => [start.pairs, start.samples.length, start.uncounted.length]),
    [[0, 0, 0]],
  );
  // Nothing to zero on, but the stored pairs are still there to draw, on their own first 500 ms.
  assert.equal(missing.beforeBaselineWindow.length, 40);
  assert.equal(missing.beforeBaselineOwnZero, true);
  for (const sample of missing.beforeBaselineWindow) assert.equal(sample.value, 0);

  // A window that opens before the first stored pair uses the pairs it does cover.
  const early = buildStoredProxySeries(simultaneous(relative), { baselineWindow: { startMs: -1000, endMs: 100 } });
  assert.equal(early.baselineSampleCount, 5);
  assert.equal(early.samples.length, 40);
  assert.deepEqual(early.beforeBaselineWindow, []);
  assert.equal(early.beforeBaselineOwnZero, false);
});

test("an unusable baseline window falls back to the first 500 ms of pairs", () => {
  const relative = Array.from({ length: 60 }, (_, i) => [i * 20, i < 30 ? 3 : 40] as const);
  const fallback = buildStoredProxySeries(simultaneous(relative));
  assert.equal(fallback.baselineDeg, 3);
  const unusable = [
    null,
    undefined,
    { startMs: Number.NaN, endMs: 500 },
    { startMs: 600, endMs: Number.POSITIVE_INFINITY },
    { startMs: 600, endMs: 600 },
    { startMs: 700, endMs: 600 },
  ];
  for (const baselineWindow of unusable) {
    const series = buildStoredProxySeries(simultaneous(relative), { baselineWindow });
    assert.equal(series.baselineSource, "first_samples");
    assert.deepEqual(series.samples, fallback.samples);
    assert.deepEqual(series.starts, []);
    assert.deepEqual(series.beforeBaselineWindow, []);
  }
  // A list with nothing usable falls back to the single window, and then to the first 500 ms.
  const listed = buildStoredProxySeries(simultaneous(relative), { baselineWindows: unusable, baselineWindow: null });
  assert.equal(listed.baselineSource, "first_samples");
  assert.deepEqual(listed.samples, fallback.samples);
  const single = buildStoredProxySeries(simultaneous(relative), {
    baselineWindows: [],
    baselineWindow: { startMs: 600, endMs: 1100 },
  });
  assert.equal(single.baselineSource, "window");
  assert.equal(single.baselineDeg, 40);
});

test("each start is zeroed on its own window and oriented over its own pairs; the latest is the top level", () => {
  // Start 1 rests at 0 and bends the raw difference up by 40. Start 2, after a reload, rests at 8 and bends it down
  // by 50 (the strap settled differently).
  const relative: Array<[number, number]> = [];
  for (let i = 0; i < 100; i += 1) {
    const bend = i >= 30 && i < 70 ? 40 * Math.sin((Math.PI * (i - 30)) / 40) : 0;
    relative.push([i * 20, bend]);
  }
  for (let i = 0; i < 100; i += 1) {
    const bend = i >= 30 && i < 70 ? 50 * Math.sin((Math.PI * (i - 30)) / 40) : 0;
    relative.push([5000 + i * 20, 8 - bend]);
  }
  // Out of order on purpose: the windows are sorted, and a repeated start time is one start.
  const windows = [
    { startMs: 5000, endMs: 5500 },
    { startMs: 0, endMs: 500 },
    { startMs: 5000, endMs: 5500 },
  ];
  const series = buildStoredProxySeries(simultaneous(relative), { baselineWindows: windows });
  assert.equal(series.baselineSource, "window");
  assert.deepEqual(
    series.starts.map((start) => [start.window.startMs, start.pairs, start.baselineDeg, start.orientation]),
    [
      [0, 100, 0, 1],
      [5000, 100, 8, -1],
    ],
  );
  close(Math.max(...series.starts[0].samples.map((sample) => sample.value)), 40, 0.1);
  close(Math.max(...series.starts[1].samples.map((sample) => sample.value)), 50, 0.1);
  assert.deepEqual(series.beforeBaselineWindow, []);
  assert.deepEqual(series.samples, series.starts[1].samples);
  assert.equal(series.baselineDeg, 8);
  assert.equal(series.orientation, -1);
});

test("a start whose window holds no stored pair is kept for drawing on its own zero, never counted", () => {
  // Two starts; the second one's zero window (3000-3500 ms) was dropped before it was stored.
  const relative: Array<[number, number]> = [];
  for (let tMs = 0; tMs < 2000; tMs += 20) relative.push([tMs, 0]);
  for (let tMs = 3500; tMs < 5000; tMs += 20) relative.push([tMs, 12]);
  const series = buildStoredProxySeries(simultaneous(relative), {
    baselineWindows: [
      { startMs: 0, endMs: 500 },
      { startMs: 3000, endMs: 3500 },
    ],
  });
  const [first, second] = series.starts;
  assert.equal(first.pairs, 100);
  assert.equal(first.samples.length, 100);
  assert.deepEqual(first.uncounted, []);
  assert.equal(second.pairs, 75);
  assert.equal(second.baselineDeg, null);
  assert.deepEqual(second.samples, []);
  assert.equal(second.uncounted.length, 75);
  for (const sample of second.uncounted) assert.equal(sample.value, 0);
  // The top level is the latest start, which has nothing to count.
  assert.deepEqual(series.samples, []);
});
