import assert from "node:assert/strict";
import { test } from "node:test";

import { GUIDE_MAX_DRAW_DEG, createSmoother, drawAngleDeg, heelSlidePose, type Point } from "./legGuide.ts";

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const hip = { x: 100, y: 140 };
const thigh = 116;
const shank = 106;

test("the pose keeps both segment lengths and the heel on the bed at every angle", () => {
  for (const bend of [0, 30, 60, 90, 110, GUIDE_MAX_DRAW_DEG]) {
    const { knee, foot } = heelSlidePose(bend, hip, thigh, shank);
    close(distance(hip, knee), thigh);
    close(distance(knee, foot), shank);
    close(foot.y, hip.y);
  }
});

test("a straight leg lies flat along the bed", () => {
  const { knee, foot } = heelSlidePose(0, hip, thigh, shank);
  close(knee.y, hip.y);
  close(knee.x, hip.x + thigh);
  close(foot.x, hip.x + thigh + shank);
});

test("bending lifts the knee and draws the heel in", () => {
  const straight = heelSlidePose(0, hip, thigh, shank);
  const bent = heelSlidePose(90, hip, thigh, shank);
  assert.ok(bent.knee.y < hip.y); // up, in SVG coordinates
  assert.ok(bent.foot.x < straight.foot.x);
});

test("a negative drawing angle draws a straight leg", () => {
  assert.deepEqual(heelSlidePose(-15, hip, thigh, shank), heelSlidePose(0, hip, thigh, shank));
});

test("the drawing angle is clamped for drawing and unknown draws straight", () => {
  assert.equal(drawAngleDeg(null), 0);
  assert.equal(drawAngleDeg(Number.NaN), 0);
  assert.equal(drawAngleDeg(-8), 0);
  assert.equal(drawAngleDeg(47.5), 47.5);
  assert.equal(drawAngleDeg(170), GUIDE_MAX_DRAW_DEG);
});

test("the smoother passes the first sample straight through", () => {
  assert.equal(createSmoother()(42, 0), 42);
});

test("the smoother eases toward a new value and settles on it", () => {
  const smooth = createSmoother(90);
  smooth(0, 0);
  const early = smooth(90, 16);
  assert.ok(early > 0 && early < 90);
  close(smooth(90, 2000), 90, 0.05);
});

test("the smoother weights by elapsed time, not by sample count", () => {
  const coarse = createSmoother(90);
  const fine = createSmoother(90);
  coarse(0, 0);
  fine(0, 0);
  const oneStep = coarse(60, 80);
  let manySteps = 0;
  for (let now = 10; now <= 80; now += 10) manySteps = fine(60, now);
  close(oneStep, manySteps, 1e-9);
});

test("the smoother ignores non-finite samples", () => {
  const smooth = createSmoother();
  assert.ok(Number.isNaN(smooth(Number.NaN, 0)));
  smooth(10, 0);
  assert.equal(smooth(Number.NaN, 16), 10);
  assert.equal(smooth(20, Number.NaN), 10);
});
