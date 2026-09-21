import assert from "node:assert/strict";
import test from "node:test";

import { EXERCISE_SUMMARY_KIND, buildExerciseSummary, componentRecord, scoreRecord } from "./exerciseRecords.ts";
import type { RepSegment } from "../../lib/motion/reps.ts";

function segment(startMs: number, endMs: number, peakValue: number): RepSegment {
  return { startIndex: 0, endIndex: 1, peakIndex: 1, startMs, endMs, peakMs: (startMs + endMs) / 2, peakValue };
}

const BASE = {
  exerciseSlug: "ankle-pumps",
  inputMode: "camera" as const,
  repsCounted: 2,
  targetReps: 15,
  segments: [segment(1_000, 3_000, 21.456), segment(4_000, 6_000, 19.2)],
  signalDefinition: "wrap(foot.pitch - shank.pitch), baseline-zeroed, oriented",
  thresholds: { enterDeg: 8, exitDeg: 3.2, minRepMs: 250, source: "exercise" },
  maxGapMs: 1_000,
  baselineWindows: [{ start: 900, end: 1_400 }],
  restartedAfterReload: false,
  sensors: null,
  telemetry: { framesConfirmed: 120, pendingAtFinish: 0, errors: null, dropped: null },
  score: null,
};

test("a summary says which exercise it was and where the numbers came from", () => {
  const summary = buildExerciseSummary(BASE);
  assert.equal(summary.kind, EXERCISE_SUMMARY_KIND);
  assert.equal(summary.exercise_slug, "ankle-pumps");
  assert.equal(summary.input_mode, "camera");
  assert.equal(summary.signal.source, "camera");
  assert.equal(summary.signal.definition, BASE.signalDefinition);
});

test("a stored signal never claims to be a calibrated knee angle", () => {
  const summary = buildExerciseSummary(BASE);
  assert.equal(summary.signal.calibrated, false);
  assert.equal(summary.signal.knee_flexion, false);
});

test("the latest zero is the last of the list, and an empty list stores null rather than a made-up span", () => {
  const two = buildExerciseSummary({
    ...BASE,
    baselineWindows: [
      { start: 900, end: 1_400 },
      { start: 5_000, end: 5_500 },
    ],
  });
  assert.deepEqual(two.baseline_window_ms, { start: 5_000, end: 5_500 });

  const none = buildExerciseSummary({ ...BASE, baselineWindows: [] });
  assert.equal(none.baseline_window_ms, null);
  assert.deepEqual(none.baseline_windows_ms, []);
});

test("repetition segments are stored on the receive-time clock, rounded but not reshaped", () => {
  const summary = buildExerciseSummary(BASE);
  assert.deepEqual(summary.rep_segments, [
    { start_ms: 1_000, end_ms: 3_000, peak_rel_deg: 21.46 },
    { start_ms: 4_000, end_ms: 6_000, peak_rel_deg: 19.2 },
  ]);
});

test("an exercise with no scoring config stores no score, rather than a score of zero", () => {
  assert.equal(buildExerciseSummary(BASE).score, null);
});

test("a component nobody measured is stored as null with no weight, never as 0 and never as 100", () => {
  const abstained = componentRecord({ score: null, weightUsed: null, abstained: ["tempo", "controlledReturn"] });
  assert.equal(abstained.score, null);
  assert.equal(abstained.weight_used, null);
  assert.deepEqual(abstained.abstained, ["tempo", "controlledReturn"]);
  assert.deepEqual(abstained.measured, []);
  assert.equal(componentRecord(null).score, null);
});

test("a score computed from part of the evidence is marked partial", () => {
  const partial = scoreRecord(
    78,
    { score: 82, weightUsed: 0.5, measured: ["smoothness"], abstained: ["tempo", "controlledReturn"] },
    { score: 100, weightUsed: 0.2, measured: ["volume"] },
    { score: 60, weightUsed: 0.3, measured: ["target"] },
  );
  assert.equal(partial.partial, true, "two abstained sub-metrics must be visible in the record");
  assert.equal(partial.execution, 78);
  assert.equal(partial.correctness.weight_used, 0.5);
});

test("a score with every component measured is not marked partial", () => {
  const full = scoreRecord(
    91,
    { score: 88, weightUsed: 0.5, measured: ["smoothness", "tempo", "controlledReturn", "consistency", "hold"] },
    { score: 100, weightUsed: 0.2, measured: ["volume"] },
    { score: 92, weightUsed: 0.3, measured: ["target"] },
  );
  assert.equal(full.partial, false);
});

test("a rollup where nothing at all could be measured stores null and is partial", () => {
  const nothing = scoreRecord(null, { score: null }, { score: null }, { score: null });
  assert.equal(nothing.execution, null);
  assert.equal(nothing.partial, true);
});

test("a camera session stores no sensor records rather than empty ones", () => {
  assert.equal(buildExerciseSummary(BASE).sensors, null);
});

test("the thresholds record says where the entry threshold came from", () => {
  const summary = buildExerciseSummary({
    ...BASE,
    thresholds: { enterDeg: 30, exitDeg: 12, minRepMs: 250, source: "rubric" },
  });
  assert.equal(summary.thresholds.source, "rubric");
  assert.equal(summary.thresholds.enter_deg, 30);
});
