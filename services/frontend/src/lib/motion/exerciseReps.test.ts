import assert from "node:assert/strict";
import test from "node:test";

import { STATIC_ENTER_DEG, exerciseThresholds, rubricExcursionDeg } from "./exerciseReps.ts";

test("an exercise's own minimum excursion sets the entry threshold", () => {
  const heelSlide = exerciseThresholds(22.5);
  assert.equal(heelSlide.enterDeg, 22.5);
  assert.equal(heelSlide.source, "exercise");
});

test("a small threshold survives, because not every exercise is a 90-degree knee bend", () => {
  // PHOENIX enters an ankle pump at 4 degrees (exercise_signals.py). Heel Slide's 18-degree floor would count none.
  const anklePump = exerciseThresholds(4);
  assert.equal(anklePump.enterDeg, 4);
  assert.ok(anklePump.exitDeg < 4);

  const legRaise = exerciseThresholds(8);
  assert.equal(legRaise.enterDeg, 8);
});

test("a rubric may raise the entry threshold but never lower it", () => {
  const raised = exerciseThresholds(22.5, { min_valid_excursion_deg: 30 });
  assert.equal(raised.enterDeg, 30);
  assert.equal(raised.source, "rubric");

  const lowered = exerciseThresholds(22.5, { min_valid_excursion_deg: 5 });
  assert.equal(lowered.enterDeg, 22.5, "a rubric must not let jitter count as repetitions");
  assert.equal(lowered.source, "exercise");
});

test("a declared zero is a statement, not a blank: a static hold gets the stillness band", () => {
  // Quad Set declares minValidExcursionDeg 0 — the spec's "static exercise ... Не применяется". Falling back to
  // 18 degrees there would count no repetition of an isometric hold at all; using the zero would count a tremor.
  const quadSet = exerciseThresholds(0);
  assert.equal(quadSet.enterDeg, STATIC_ENTER_DEG);
  assert.equal(quadSet.source, "static");
  assert.ok(quadSet.exitDeg > 0 && quadSet.exitDeg < quadSet.enterDeg);

  // A clinician may still raise it.
  const raised = exerciseThresholds(0, { min_valid_excursion_deg: 6 });
  assert.equal(raised.enterDeg, 6);
  assert.equal(raised.source, "rubric");
});

test("an exercise that declares nothing falls back, and says that it fell back", () => {
  const unknown = exerciseThresholds(null);
  assert.equal(unknown.enterDeg, 18);
  assert.equal(unknown.source, "fallback");

  // A rubric is still honoured when the exercise itself declares nothing.
  const fromRubricOnly = exerciseThresholds(null, { min_valid_excursion_deg: 12 });
  assert.equal(fromRubricOnly.enterDeg, 12);
  assert.equal(fromRubricOnly.source, "rubric");
});

test("the exit threshold always sits below the entry threshold", () => {
  for (const enter of [4, 8, 10, 15, 18, 22.5, 30, 80]) {
    const resolved = exerciseThresholds(enter);
    assert.ok(resolved.exitDeg > 0, `exit must be positive for enter ${enter}`);
    assert.ok(resolved.exitDeg < resolved.enterDeg, `exit must be under enter for ${enter}`);
  }
});

test("an explicit exit threshold is used, but is never allowed to reach the entry threshold", () => {
  assert.equal(exerciseThresholds(22.5, undefined, 7).exitDeg, 7);
  const absurd = exerciseThresholds(10, undefined, 99);
  assert.ok(absurd.exitDeg < absurd.enterDeg);
});

test("a malformed rubric is ignored rather than trusted", () => {
  assert.equal(rubricExcursionDeg(null), null);
  assert.equal(rubricExcursionDeg("30"), null);
  assert.equal(rubricExcursionDeg({}), null);
  assert.equal(rubricExcursionDeg({ min_valid_excursion_deg: "30" }), null);
  assert.equal(rubricExcursionDeg({ min_valid_excursion_deg: Number.NaN }), null);
  assert.equal(rubricExcursionDeg({ min_valid_excursion_deg: -4 }), null);
  assert.equal(rubricExcursionDeg({ min_valid_excursion_deg: 30 }), 30);
});
