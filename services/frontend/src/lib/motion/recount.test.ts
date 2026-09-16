import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type BaselineWindow,
  type ProxySample,
  PROXY_BASELINE_MS,
  buildStoredProxySeries,
  createPairer,
  createProxyOrienter,
} from "./flexion.ts";
import { type RepCounterOptions, type RepSegment, countOrientedRepetitions, createRepCounter, heelSlideThresholds } from "./reps.ts";

// The clinician recount against the live count, on whole sessions played through the exercise screen's
// steps: while the screen is armed every reading is recorded, thigh and shank are paired, zeroed, oriented
// and counted, and each start resets the pairer and the orienter but not the counter. Covers a start
// abandoned because a sensor dropped, a pause in the data in the middle of a rep, and a session that starts
// with the leg bent, whose current behaviour is pinned here (see flexion.ts, "Known limitation").

const STEP_MS = 20; // 50 Hz
const SHANK_LAG_MS = 6; // independent BLE links do not notify together
const THIGH_PITCH = 10;
const HEEL_SLIDE = heelSlideThresholds({ min_valid_excursion_deg: 22.5 });

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

type Role = "thigh" | "shank";

interface Plan {
  durationMs: number;
  /** True shank-minus-thigh pitch over time, before jitter: 0 is the rest pose, a bend is positive. */
  relative: (tMs: number) => number;
  /** Spans in which one sensor sends nothing. */
  silent?: Array<{ role: Role; fromMs: number; toMs: number }>;
  /** Spans in which the screen is armed. Each one is a start: pairer and orienter are reset. */
  armed: Array<{ fromMs: number; toMs: number }>;
  /** Every start after the first is on a reloaded page, so the rep counter starts over too. */
  reloads?: boolean;
}

/** Ten slides from `firstMs`: 1 s bending to `peak`, `holdMs` at the top, 1 s back, rest until the next. */
function slides(firstMs: number, peak: number, { reps = 10, cycleMs = 5000, holdMs = 300 } = {}) {
  return (tMs: number) => {
    const t = tMs - firstMs;
    if (t < 0 || t >= reps * cycleMs) return 0;
    const phase = t % cycleMs;
    if (phase < 1000) return peak * ease(phase / 1000);
    if (phase < 1000 + holdMs) return peak;
    if (phase < 2000 + holdMs) return peak * (1 - ease((phase - 1000 - holdMs) / 1000));
    return 0;
  };
}

function play(plan: Plan, options: RepCounterOptions = HEEL_SLIDE, seed = 5) {
  const rand = mulberry32(seed);
  const jitter = () => (rand() * 2 - 1) * 0.4;
  const pairer = createPairer();
  const orienter = createProxyOrienter();
  let counter = createRepCounter(options);
  const counters = [counter];
  // Each start's zero window, as the screen saves it once the zero is taken.
  const windows: BaselineWindow[] = [];
  let windowSaved = false;
  const stored: Record<Role, Array<[number, number]>> = { thigh: [], shank: [] };
  const live: ProxySample[] = [];
  let start = -1;

  const deliver = (role: Role, tMs: number, pitch: number) => {
    if (plan.silent?.some((span) => span.role === role && tMs >= span.fromMs && tMs < span.toMs)) return;
    const armed = plan.armed.findIndex((span) => tMs >= span.fromMs && tMs < span.toMs);
    if (armed < 0) return;
    if (armed !== start) {
      if (plan.reloads && start >= 0) {
        counter = createRepCounter(options);
        counters.push(counter);
      }
      start = armed;
      pairer.reset();
      orienter.reset();
      windowSaved = false;
    }
    stored[role].push([tMs, pitch]);
    const pair = pairer.push(role, tMs, pitch);
    if (!pair) return;
    const value = orienter.push(pair.tMs, pair.relativeDeg);
    if (value === null) return;
    if (!windowSaved && orienter.baselineWindow) {
      windows.push(orienter.baselineWindow);
      windowSaved = true;
    }
    live.push({ tMs: pair.tMs, value });
    counter.push(pair.tMs, value);
  };

  for (let tMs = 0; tMs < plan.durationMs; tMs += STEP_MS) {
    deliver("thigh", tMs, THIGH_PITCH + jitter());
    const shankMs = tMs + SHANK_LAG_MS;
    deliver("shank", shankMs, THIGH_PITCH + plan.relative(shankMs) + jitter());
  }
  return { counter, counters, orienter, stored, live, windows };
}

function recount(
  stored: Record<Role, Array<[number, number]>>,
  baselineWindow?: BaselineWindow | null,
  options: RepCounterOptions = HEEL_SLIDE,
) {
  const series = buildStoredProxySeries(stored, { baselineWindow });
  return { series, report: countOrientedRepetitions(series.samples, options) };
}

/** Same reps, each boundary within two samples: the two pair sets are close, not identical. */
function assertSameReps(stored: readonly RepSegment[], live: readonly RepSegment[]) {
  assert.equal(stored.length, live.length);
  stored.forEach((segment, i) => {
    assert.ok(Math.abs(segment.startMs - live[i].startMs) <= 2 * STEP_MS, `rep ${i} start`);
    assert.ok(Math.abs(segment.endMs - live[i].endMs) <= 2 * STEP_MS, `rep ${i} end`);
  });
}

const valueNear = (series: readonly ProxySample[], tMs: number) =>
  series.reduce((best, sample) => (Math.abs(sample.tMs - tMs) < Math.abs(best.tMs - tMs) ? sample : best)).value;

test("after a start abandoned by a dropout, the recount zeroes on the live baseline window", () => {
  // Start at 1 s. The thigh goes silent 300 ms into the baseline and the screen gives that start up a second
  // later. While the patient reconnects, the rest pose moves 12 degrees in the bend direction (a strap
  // nudged). Second start at 6 s, then ten slides to 70.
  const reps = slides(8000, 70);
  const plan: Plan = {
    durationMs: 8000 + 10 * 5000 + 1000,
    relative: (tMs) => (tMs < 4000 ? 0 : 12) + reps(tMs),
    silent: [{ role: "thigh", fromMs: 1300, toMs: 2300 }],
    armed: [
      { fromMs: 1000, toMs: 2300 },
      { fromMs: 6000, toMs: Number.POSITIVE_INFINITY },
    ],
  };
  const live = play(plan);
  assert.equal(live.counter.count, 10);
  const window = live.orienter.baselineWindow;
  assert.ok(window);
  assert.equal(window.startMs, 6000 + SHANK_LAG_MS);
  assert.equal(window.endMs, window.startMs + PROXY_BASELINE_MS);

  // Zeroed on the first stored frames, which are the abandoned start's, rest sits 12 degrees up, above the
  // exit threshold, and no rep ever completes. This is what the window fixes.
  const naive = recount(live.stored);
  assert.equal(naive.series.baselineSource, "first_samples");
  assert.ok(Math.abs(naive.series.baselineDeg! - 0) < 1);
  assert.equal(naive.report.count, 0);

  const windowed = recount(live.stored, window);
  assert.equal(windowed.series.baselineSource, "window");
  assert.ok(Math.abs(windowed.series.baselineDeg! - 12) < 1);
  assert.equal(windowed.series.orientation, live.orienter.orientation);
  assert.equal(windowed.report.count, live.counter.count);
  assertSameReps(windowed.report.segments, live.counter.segments);

  // The abandoned start stays drawable, on the same zero, and out of the counted samples.
  const before = windowed.series.beforeBaselineWindow;
  assert.ok(before.length > 10);
  assert.ok(before.every((sample) => sample.tMs < window.startMs && Math.abs(sample.value + 12) < 1.5));
  assert.ok(windowed.series.samples[0].tMs >= window.startMs);
  assert.equal(before.length + windowed.series.samples.length, windowed.series.pairing.pairs);
});

test("after a reload each start is recounted on its own zero and the counts add up; the device counts the last", () => {
  // Seven slides, a reload, the strap settled 10 degrees differently, and the three slides that were left.
  const relative = (tMs: number) =>
    tMs < 38_000 ? slides(2_000, 60, { reps: 7 })(tMs) : 10 + slides(43_000, 60, { reps: 3 })(tMs);
  const live = play({
    durationMs: 60_000,
    relative,
    armed: [
      { fromMs: 0, toMs: 37_000 },
      { fromMs: 40_000, toMs: 60_000 },
    ],
    reloads: true,
  });
  assert.deepEqual(
    live.counters.map((counter) => counter.count),
    [7, 3],
  );
  assert.equal(live.windows.length, 2);

  const series = buildStoredProxySeries(live.stored, { baselineWindows: live.windows });
  const perStart = series.starts.map((start) => countOrientedRepetitions(start.samples, HEEL_SLIDE));
  assert.deepEqual(
    perStart.map((report) => report.count),
    [7, 3],
  );
  assertSameReps(
    perStart.flatMap((report) => report.segments),
    [...live.counters[0].segments, ...live.counters[1].segments],
  );
  assert.deepEqual(series.beforeBaselineWindow, []);

  // With only the latest window, as sessions saved before the list existed, the seven slides before the reload are
  // drawn and not counted.
  const latestOnly = recount(live.stored, live.windows[1]);
  assert.equal(latestOnly.report.count, 3);
  assert.ok(latestOnly.series.beforeBaselineWindow.length > 1_500);

  // And the first start's zero carried across the reload would leave the last three resting 10 degrees up.
  const firstZeroOnly = recount(live.stored, live.windows[0]);
  assert.notEqual(firstZeroOnly.report.count, 10);
});

test("a pause in the data in the middle of a rep discards that rep, live and in the recount", () => {
  // Ten slides held 2.5 s at the top. In the fourth the thigh sends nothing from 800 ms in, past the entry
  // threshold, until 3 s in, while the leg is still held bent. In the seventh rest the shank drops out
  // for 1.5 s, which must not change anything.
  const first = 2000;
  const cycleMs = 6500;
  const plan: Plan = {
    durationMs: first + 10 * cycleMs + 1000,
    relative: slides(first, 60, { cycleMs, holdMs: 2500 }),
    silent: [
      { role: "thigh", fromMs: first + 3 * cycleMs + 800, toMs: first + 3 * cycleMs + 3000 },
      { role: "shank", fromMs: first + 6 * cycleMs + 4600, toMs: first + 6 * cycleMs + 6100 },
    ],
    armed: [{ fromMs: 1000, toMs: Number.POSITIVE_INFINITY }],
  };
  const live = play(plan);
  const window = live.orienter.baselineWindow;
  assert.equal(live.counter.count, 9);
  assert.equal(live.counter.cancelled, 1);
  assert.ok(!live.counter.segments.some((s) => s.startMs >= first + 3 * cycleMs && s.startMs < first + 4 * cycleMs));

  const stored = recount(live.stored, window);
  assert.equal(stored.report.count, 9);
  assert.equal(stored.report.cancelled, 1);
  assertSameReps(stored.report.segments, live.counter.segments);
  assert.equal(recount(live.stored).report.count, 9);

  // Without the pause rule both sides count the fourth rep once the data comes back: the test bites.
  const noPauseRule = { ...HEEL_SLIDE, maxGapMs: Number.POSITIVE_INFINITY };
  assert.equal(play(plan, noPauseRule).counter.count, 10);
  assert.equal(recount(live.stored, window, noPauseRule).report.count, 10);
});

// A session that starts bent. Current behaviour, pinned on purpose: it is a known limitation (flexion.ts
// header), and a later calibration change should have to update these numbers knowingly.

/** One start at 1 s with the leg bent by `bent` through the baseline, straightened over the next second, then ten slides. */
function bentStart(bent: number, peak: number): Plan {
  const reps = slides(4000, peak);
  return {
    durationMs: 4000 + 10 * 5000 + 1000,
    relative: (tMs) => (tMs < 1600 ? bent : tMs < 2600 ? bent * (1 - ease((tMs - 1600) / 1000)) : 0) + reps(tMs),
    armed: [{ fromMs: 1000, toMs: Number.POSITIVE_INFINITY }],
  };
}

test("bent start, pinned: under the entry threshold, or not bent at all, all ten count on both sides", () => {
  for (const [bent, peak] of [
    [0, 70],
    [20, 70],
    [0, 30],
  ]) {
    const live = play(bentStart(bent, peak));
    const stored = recount(live.stored, live.orienter.baselineWindow);
    assert.equal(live.counter.count, 10, `live, bent ${bent}, peak ${peak}`);
    assert.equal(stored.report.count, 10, `stored, bent ${bent}, peak ${peak}`);
    assert.equal(stored.series.orientation, 1);
  }
});

test("bent start, pinned: past the entry threshold the live count has one phantom rep the recount does not", () => {
  const live = play(bentStart(25, 70));
  const stored = recount(live.stored, live.orienter.baselineWindow);
  assert.equal(live.counter.count, 11);
  assert.equal(stored.report.count, 10);
  // The phantom opens while the leg is being straightened and closes on the way into the first real slide.
  const phantom = live.counter.segments[0];
  assert.ok(phantom.startMs > 1600 && phantom.startMs < 2600);
  assert.ok(phantom.endMs > 4000 && phantom.endMs < 5000);
  assert.equal(live.orienter.orientation, 1);
  assert.equal(stored.series.orientation, 1);
});

test("bent start, pinned: bent by more than half the slides' reach, both sides read inverted", () => {
  const live = play(bentStart(40, 70));
  const stored = recount(live.stored, live.orienter.baselineWindow);
  assert.equal(live.orienter.orientation, -1);
  assert.equal(stored.series.orientation, -1);
  assert.equal(live.counter.count, 10);
  assert.equal(stored.report.count, 10);
  // Mid-session, the straight leg reads +40 and the top of a slide reads 40 - 70 = -30.
  const restMs = 4000 + 5 * 5000 + 3500;
  const topMs = 4000 + 5 * 5000 + 1150;
  for (const series of [live.live, stored.series.samples]) {
    assert.ok(Math.abs(valueNear(series, restMs) - 40) < 1.5);
    assert.ok(Math.abs(valueNear(series, topMs) + 30) < 1.5);
  }
});

test("bent start, pinned: small slides after a start bent by more than half of them count nothing", () => {
  const live = play(bentStart(16, 30));
  const stored = recount(live.stored, live.orienter.baselineWindow);
  assert.equal(live.counter.count, 0);
  assert.equal(stored.report.count, 0);
  assert.equal(stored.report.reason, "no_excursion_detected");
  assert.equal(stored.series.orientation, -1);
});
