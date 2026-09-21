// Pins the angle maths against cases worked out by hand, because nothing else can: there is no
// reference pose in the repo to compare against, and a camera angle that is quietly wrong by ten
// degrees looks exactly like a correct one on screen.
//
// Conventions under test, restated from jointAngles.ts so a failing assertion is readable on its own:
//   interiorAngleDeg    unsigned 0..180 at the middle point; 180 = collinear = a straight limb.
//   kneeFlexionDeg      180 - interior at the knee; 0 = straight leg, larger = more bent.
//   thighElevationDeg   signed -90..90; 0 = thigh horizontal in the image, positive = knee above hip.
//   ankleInteriorDeg    raw interior at the ankle; no anatomical neutral is subtracted.
//
// node --test (npm run test:unit), so the import carries an explicit .ts extension. Vitest does not
// see this directory at all — vitest.config.ts includes only ble, telemetry and scoring.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ANGLE_LANDMARKS,
  type AnglePoint,
  MIN_LANDMARK_VISIBILITY,
  angleChain,
  ankleInteriorDeg,
  createAngleSmoother,
  createMedian3,
  interiorAngleDeg,
  jointAngleDeg,
  kneeFlexionDeg,
  readAnkleInterior,
  readJointAngle,
  readKneeFlexion,
  thighElevationDeg,
} from "./jointAngles.ts";

/** A 33-slot frame of fully-visible landmarks at the origin, with only the named points placed. */
function frame(points: Partial<Record<keyof typeof ANGLE_LANDMARKS, [number, number, number?]>>): AnglePoint[] {
  const lm: AnglePoint[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  for (const [name, value] of Object.entries(points)) {
    const [x, y, vis] = value as [number, number, number?];
    lm[ANGLE_LANDMARKS[name as keyof typeof ANGLE_LANDMARKS]] = {
      x,
      y,
      z: 0,
      visibility: vis ?? 1,
    };
  }
  return lm;
}

const near = (actual: number, expected: number, tol = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${expected} +/- ${tol}, got ${actual}`,
  );

test("a straight limb reads 180 interior and 0 knee flexion", () => {
  const lm = frame({ leftHip: [0.5, 0.2], leftKnee: [0.5, 0.5], leftAnkle: [0.5, 0.8] });
  near(interiorAngleDeg(lm[23], lm[25], lm[27], { aspect: 4 / 3 })!, 180, 1e-9);
  near(kneeFlexionDeg(lm, "left", { aspect: 4 / 3 })!.deg, 0, 1e-9);
});

test("a right angle reads 90, and axis-aligned arms are immune to the aspect correction", () => {
  // Hip straight above the knee, ankle straight to its right: the arms lie on the two axes, which
  // scaling x cannot rotate. Uncorrected and corrected must agree exactly — the one case where they do.
  const lm = frame({ leftHip: [0.5, 0.2], leftKnee: [0.5, 0.5], leftAnkle: [0.8, 0.5] });
  near(interiorAngleDeg(lm[23], lm[25], lm[27], { aspect: 1 })!, 90, 1e-9);
  near(interiorAngleDeg(lm[23], lm[25], lm[27], { aspect: 16 / 9 })!, 90, 1e-9);
  near(kneeFlexionDeg(lm, "left", { aspect: 4 / 3 })!.deg, 90, 1e-9);
});

test("the aspect correction moves a 4:3 obtuse angle by the 8.13 degrees the header predicts", () => {
  // The worked example from jointAngles.ts's header: vertex (0.5,0.5), arms to (0.5,0.3) and (0.7,0.7).
  const a: AnglePoint = { x: 0.5, y: 0.3 };
  const b: AnglePoint = { x: 0.5, y: 0.5 };
  const c: AnglePoint = { x: 0.7, y: 0.7 };
  const raw = interiorAngleDeg(a, b, c, { aspect: 1 })!;
  const corrected = interiorAngleDeg(a, b, c, { aspect: 4 / 3 })!;
  near(raw, 135, 1e-9);
  // acos(-0.6) — the arms become (0,-0.2) and (0.26667,0.2) once x is scaled by 4/3.
  near(corrected, (Math.acos(-0.6) * 180) / Math.PI, 1e-9);
  near(corrected, 126.8698976, 1e-6);
  assert.ok(raw - corrected > 5, `expected more than 5 degrees of error, got ${raw - corrected}`);

  // 16:9 is worse still, which is the reason the option is not optional in practice.
  const wide = interiorAngleDeg(a, b, c, { aspect: 16 / 9 })!;
  assert.ok(raw - wide > raw - corrected, "16:9 must distort more than 4:3");
});

test("a landmark below the visibility floor rejects the frame and names the part", () => {
  const lm = frame({
    leftHip: [0.5, 0.2],
    leftKnee: [0.5, 0.5, 0.4], // below MIN_LANDMARK_VISIBILITY
    leftAnkle: [0.5, 0.8],
  });
  assert.equal(MIN_LANDMARK_VISIBILITY, 0.5);
  assert.equal(kneeFlexionDeg(lm, "left", { aspect: 4 / 3 }), null);

  const reading = readKneeFlexion(lm, "left", { aspect: 4 / 3 });
  assert.equal(reading.ok, false);
  assert.equal(reading.problem?.rejected, "low_visibility");
  assert.equal(reading.problem?.landmark, "leftKnee");
  assert.equal(reading.problem?.part, "knee");
});

test("a landmark that is absent reads as missing, not as low visibility", () => {
  const lm = frame({ leftHip: [0.5, 0.2], leftKnee: [0.5, 0.5], leftAnkle: [0.5, 0.8] });
  lm[ANGLE_LANDMARKS.leftAnkle] = { x: Number.NaN, y: 0.8, visibility: 1 };
  const reading = readKneeFlexion(lm, "left", { aspect: 4 / 3 });
  assert.equal(reading.ok, false);
  assert.equal(reading.problem?.rejected, "missing");
  assert.equal(reading.problem?.part, "ankle");
});

test("a collapsed segment is degenerate, and names no single landmark", () => {
  // Ankle sitting on top of the knee: the shank has no direction, so neither has the angle.
  const lm = frame({ leftHip: [0.5, 0.2], leftKnee: [0.5, 0.5], leftAnkle: [0.5, 0.5] });
  const reading = readKneeFlexion(lm, "left", { aspect: 4 / 3 });
  assert.equal(reading.ok, false);
  assert.equal(reading.problem?.rejected, "degenerate");
  assert.equal(reading.problem?.landmark, null);
  assert.equal(reading.problem?.part, null);
});

test("thigh elevation is signed: flat is 0, knee above the hip is positive, below is negative", () => {
  const flat = frame({ rightHip: [0.3, 0.5], rightKnee: [0.7, 0.5] });
  near(thighElevationDeg(flat, "right", { aspect: 4 / 3 })!.deg, 0, 1e-9);

  const up = frame({ rightHip: [0.5, 0.6], rightKnee: [0.5, 0.3] });
  near(thighElevationDeg(up, "right", { aspect: 4 / 3 })!.deg, 90, 1e-9);

  const down = frame({ rightHip: [0.5, 0.3], rightKnee: [0.5, 0.6] });
  near(thighElevationDeg(down, "right", { aspect: 4 / 3 })!.deg, -90, 1e-9);

  // 45 degrees, in aspect-corrected units: dx must equal dy after x is scaled.
  const aspect = 4 / 3;
  const diagonal = frame({ rightHip: [0.4, 0.5], rightKnee: [0.4 + 0.3 / aspect, 0.2] });
  near(thighElevationDeg(diagonal, "right", { aspect })!.deg, 45, 1e-9);
});

test("the ankle angle is the raw interior at the ankle, and falls back to the heel", () => {
  const withToe = frame({
    leftKnee: [0.5, 0.5],
    leftAnkle: [0.5, 0.8],
    leftFootIndex: [0.7, 0.8],
    leftHeel: [0.44, 0.8],
  });
  near(ankleInteriorDeg(withToe, "left", { aspect: 1 })!.deg, 90, 1e-9);

  // Toe lost under a blanket: the heel takes over, and the angle is the other way round the ankle.
  const heelOnly = frame({
    leftKnee: [0.5, 0.5],
    leftAnkle: [0.5, 0.8],
    leftFootIndex: [0.7, 0.8, 0.2],
    leftHeel: [0.44, 0.8],
  });
  near(ankleInteriorDeg(heelOnly, "left", { aspect: 1 })!.deg, 90, 1e-9);

  // Neither distal point: the toe is what the patient has to bring back into frame, so it is reported.
  const neither = frame({
    leftKnee: [0.5, 0.5],
    leftAnkle: [0.5, 0.8],
    leftFootIndex: [0.7, 0.8, 0.2],
    leftHeel: [0.44, 0.8, 0.1],
  });
  const reading = readAnkleInterior(neither, "left", { aspect: 1 });
  assert.equal(reading.ok, false);
  assert.equal(reading.problem?.part, "foot");
  assert.equal(reading.problem?.landmark, "leftFootIndex");
});

test("confidence is the lowest visibility in the chain, not an average", () => {
  const lm = frame({ leftHip: [0.5, 0.2, 0.9], leftKnee: [0.5, 0.5, 0.62], leftAnkle: [0.5, 0.8, 0.75] });
  near(kneeFlexionDeg(lm, "left", { aspect: 4 / 3 })!.confidence, 0.62, 1e-9);
});

test("jointAngleDeg dispatches to the same numbers as the named functions", () => {
  const lm = frame({
    rightHip: [0.5, 0.2],
    rightKnee: [0.5, 0.5],
    rightAnkle: [0.8, 0.5],
    rightFootIndex: [0.8, 0.8],
  });
  const opts = { aspect: 4 / 3 };
  assert.deepEqual(jointAngleDeg("knee", lm, "right", opts), kneeFlexionDeg(lm, "right", opts));
  assert.deepEqual(jointAngleDeg("thigh", lm, "right", opts), thighElevationDeg(lm, "right", opts));
  assert.deepEqual(jointAngleDeg("ankle", lm, "right", opts), ankleInteriorDeg(lm, "right", opts));
  assert.deepEqual(readJointAngle("knee", lm, "right", opts).sample, kneeFlexionDeg(lm, "right", opts));
});

test("angleChain names the points each angle is drawn from, and repeats the hip for thigh", () => {
  assert.deepEqual(angleChain("knee", "left"), [23, 25, 27]);
  assert.deepEqual(angleChain("knee", "right"), [24, 26, 28]);
  assert.deepEqual(angleChain("ankle", "right"), [26, 28, 32]);
  const [a, b] = angleChain("thigh", "left");
  assert.equal(a, b, "thigh has two real points; the repeat is how the caller knows to draw no arc");
});

test("a horizontally mirrored frame gives the same angles, which is why only raw landmarks are used", () => {
  // drawSkeleton's landmarkPx returns pixels that are ALREADY mirrored for the selfie view. Mirroring
  // negates x. Both angles here survive it — the interior one because it is unsigned, the elevation
  // because it reads the sign of dy — but an in-plane signed angle would invert, and nothing about the
  // call site would show it. So angles are taken from the raw landmarks and never from mirrored pixels.
  const lm = frame({ leftHip: [0.4, 0.5], leftKnee: [0.7, 0.2], leftAnkle: [0.9, 0.6] });
  const mirrored = lm.map((p) => ({ ...p, x: 1 - p.x }));
  const opts = { aspect: 4 / 3 };
  near(kneeFlexionDeg(mirrored, "left", opts)!.deg, kneeFlexionDeg(lm, "left", opts)!.deg, 1e-9);
  near(thighElevationDeg(mirrored, "left", opts)!.deg, thighElevationDeg(lm, "left", opts)!.deg, 1e-9);

  // And the sign that WOULD flip, shown directly: the raw in-plane bearing of the thigh.
  const bearing = (f: AnglePoint[]) =>
    Math.atan2(-(f[25].y - f[23].y), (f[25].x - f[23].x) * (4 / 3));
  assert.ok(
    Math.abs(bearing(mirrored) - bearing(lm)) > 1,
    "a signed in-plane bearing must change under a mirror; that is the trap being documented",
  );
});

test("median-of-3 removes a single-frame spike and returns null until it has three samples", () => {
  const median = createMedian3();
  assert.equal(median(10), null);
  assert.equal(median(11), null);
  assert.equal(median(12), 11);
  assert.equal(median(900), 12, "the spike must not reach the output");
  assert.equal(median(13), 13);
  assert.equal(median(Number.NaN), null);
});

test("the smoother takes the first sample outright and then converges toward a step", () => {
  const smooth = createAngleSmoother(90);
  assert.equal(smooth(0, 0), 0);
  let value = 0;
  for (let i = 1; i <= 60; i += 1) value = smooth(50, i * 16.7);
  assert.ok(Math.abs(value - 50) < 0.01, `expected convergence to 50, got ${value}`);

  // One 90 ms time constant is one e-folding, whatever the frame rate it is reached at.
  const coarse = createAngleSmoother(90);
  coarse(0, 0);
  near(coarse(100, 90), 100 * (1 - Math.exp(-1)), 1e-9);

  const fine = createAngleSmoother(90);
  fine(0, 0);
  let stepped = 0;
  for (let i = 1; i <= 9; i += 1) stepped = fine(100, i * 10);
  near(stepped, 100 * (1 - Math.exp(-1)), 1e-9);

  // A non-finite sample leaves the value unchanged, as legGuide's original does.
  assert.equal(smooth(Number.NaN, 2000), value);
});
