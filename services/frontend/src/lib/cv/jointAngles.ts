// Joint angles from MediaPipe pose landmarks. Pure math: no React, no canvas, no runtime imports.
//
// WHY THIS FILE EXISTS. The pose engine in this directory produces 33 keypoints per frame and nothing
// in the repo turned them into an angle. poseToImu.ts builds orthonormal limb frames to synthesise a
// virtual IMU for the ONNX models; it does not measure a joint. Without this module the camera can
// draw a skeleton but cannot count a repetition, so an exercise cannot be done without hardware.
//
// WHAT IT DELIBERATELY IS NOT. These are CAMERA-FRAME angles, measured in the image plane. They are a
// picture of the movement, good enough to count repetitions and to show the patient what their leg is
// doing. They are not goniometry. They are only valid while the camera's optical axis is roughly
// perpendicular to the plane the limb moves in, and nothing here corrects for out-of-plane rotation,
// for a camera that is not level, or for lens distortion. Same doctrine as lib/motion/flexion.ts: the
// number drives a counter and a drawing, and it is never presented as a measured degree of knee
// flexion. Nothing here invents a clinical target either — a target is a value a caller passes in.
//
// SIGN CONVENTION, stated once and held everywhere below:
//   interiorAngleDeg   unsigned, 0..180, the interior angle at the middle point. 180 = the three
//                      points are collinear with the middle one between them (a straight limb).
//   kneeFlexionDeg     180 - interior at the knee. 0 = straight leg, larger = more bent. Chosen so it
//                      reads the same direction as the IMU proxy (rest near zero, bend positive) and
//                      can be pushed straight into lib/motion's orienter and rep counter.
//   thighElevationDeg  SIGNED, -90..90. 0 = thigh along the image horizontal (a leg resting on a bed,
//                      filmed side-on), positive = the knee is above the hip in the image.
//   ankleInteriorDeg   the raw interior angle at the ankle, NOT "degrees of dorsiflexion". There is no
//                      anatomical neutral to subtract without calibration, so none is subtracted.
//
// THE ASPECT-RATIO TRAP. MediaPipe normalises x by the image WIDTH and y by the image HEIGHT, so the
// normalized space is anisotropic and an angle taken from raw x,y is wrong. Every function here
// multiplies x by `aspect` (videoWidth / videoHeight) before any dot or cross product. Worked example,
// pinned in jointAngles.test.ts: the vertex (0.5,0.5) with arms to (0.5,0.3) and (0.7,0.7) reads 135
// degrees uncorrected and 126.87 degrees at 4:3 — an 8.13 degree error, and larger at 16:9.
//
// NEVER compute an angle from drawSkeleton's landmarkPx output. Those pixels are already mirrored for
// the selfie view, and mirroring negates x: it leaves an unsigned interior angle alone but flips the
// sign of a signed one, so thighElevationDeg would silently invert on a front camera.
//
// IMAGE PLANE OR worldLandmarks? The hook surfaces both on every frame, and the metric, hip-centred
// worldLandmarks are isotropic and in principle view-independent, which sounds strictly better. This
// module supports them (pass aspect 1 and use3d true) but does NOT default to them, for three reasons.
// First, the depth channel from a single RGB camera is regressed, not measured; on the lite model it is
// the noisiest of the three axes, and feeding it into the cross product adds that noise to every frame.
// Second, worldLandmarks are hip-centred but not gravity-aligned, so thigh elevation "against the
// horizontal" is still a camera-frame quantity there — the view-independence that would matter most is
// the one we do not get. Third, the skeleton the patient watches is drawn from the image landmarks, and
// a readout computed from a different channel could disagree with the picture on the same frame. The
// honest position is that nobody here has measured which is more accurate on a supine TKA patient, so
// the default is the channel that matches the drawing, and the 3-D path is available for whoever does
// that measurement.
//
// No runtime imports from sibling modules: node:test runs this source directly, which needs `.ts`
// import paths, and tsc here rejects those. Siblings share types only. That also means the index
// constants below are a hand-kept mirror of POSE_LANDMARKS in ./landmarks.ts, the same way ids.ts
// mirrors exercise_ids.json.

/** Index subset this module needs. Mirrors POSE_LANDMARKS in ./landmarks.ts; kept local on purpose. */
export const ANGLE_LANDMARKS = {
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export type AngleLandmarkName = keyof typeof ANGLE_LANDMARKS;

export type VisionSide = "left" | "right";

/**
 * Which angle an exercise is watched on. Mirrors ExerciseConfig.primarySensorRoles in
 * lib/scoring/exerciseConfigs.ts: thigh+shank -> "knee", shank+foot -> "ankle". "thigh" is the
 * straight-leg-raise exception, whose target is thigh elevation and not knee bend at all.
 */
export type JointAngleKind = "knee" | "thigh" | "ankle";

/** The coarse body part a rejected landmark belongs to, so the UI can name it without a lookup table. */
export type AnglePart = "hip" | "knee" | "ankle" | "foot";

/**
 * The minimum this module reads off a landmark. Structurally satisfied by ./landmarks.ts Landmark and
 * by MediaPipe's own NormalizedLandmark (whose `visibility` is required, not optional, in 0.10.35).
 */
export interface AnglePoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** The same floor the draw layer uses (drawSkeleton's DrawOptions.minVisibility default). */
export const MIN_LANDMARK_VISIBILITY = 0.5;

/**
 * Below this a limb segment is too short in the image for its direction to mean anything: the limb is
 * pointing at the camera, or the landmark collapsed onto its neighbour. In aspect-corrected normalized
 * units, where the whole frame is 1 wide — a thigh filmed side-on is roughly 0.15 to 0.3 of that.
 */
export const MIN_SEGMENT_LENGTH = 0.02;

export type AngleRejection = "missing" | "low_visibility" | "degenerate";

export interface AngleOptions {
  /**
   * videoWidth / videoHeight. Pass 1 for worldLandmarks. The default of 1 is WRONG for normalized
   * landmarks and is only a default so the 3-D path reads naturally — always pass the real value.
   */
  aspect?: number;
  minVisibility?: number;
  /** Use the z channel. Only meaningful for worldLandmarks; see the header. */
  use3d?: boolean;
}

export interface AngleSample {
  /** Degrees. What it means depends on the kind; the conventions are listed in the header. */
  deg: number;
  /** The lowest visibility among the landmarks the angle was built from, 0..1. */
  confidence: number;
}

/**
 * Why a frame produced no angle. `landmark`/`part` name the first landmark in the chain that failed, so
 * the screen can say "step back, your knee is out of frame" instead of freezing on a stale number. Both
 * are null for "degenerate", which is a property of the geometry and not of one point.
 */
export interface AngleProblem {
  rejected: AngleRejection;
  landmark: AngleLandmarkName | null;
  part: AnglePart | null;
}

/** A frame either produced an angle or it did not, and if it did not it says which point failed. */
export type AngleReading =
  | { ok: true; sample: AngleSample; problem: null }
  | { ok: false; sample: null; problem: AngleProblem };

const DEG = 180 / Math.PI;

function partOf(name: AngleLandmarkName): AnglePart {
  if (name === "leftHip" || name === "rightHip") return "hip";
  if (name === "leftKnee" || name === "rightKnee") return "knee";
  if (name === "leftAnkle" || name === "rightAnkle") return "ankle";
  return "foot";
}

function fail(rejected: AngleRejection, landmark: AngleLandmarkName | null): AngleReading {
  return {
    ok: false,
    sample: null,
    problem: { rejected, landmark, part: landmark === null ? null : partOf(landmark) },
  };
}

function ok(deg: number, confidence: number): AngleReading {
  return { ok: true, sample: { deg, confidence }, problem: null };
}

function pick(side: VisionSide, left: AngleLandmarkName, right: AngleLandmarkName): AngleLandmarkName {
  return side === "left" ? left : right;
}

/** Non-finite or absent, versus present but not confidently tracked — the caller needs to tell them apart. */
function check(
  landmarks: readonly AnglePoint[],
  name: AngleLandmarkName,
  min: number,
): { point: AnglePoint } | { rejected: AngleRejection } {
  const p = landmarks[ANGLE_LANDMARKS[name]];
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return { rejected: "missing" };
  if ((p.visibility ?? 1) < min) return { rejected: "low_visibility" };
  return { point: p };
}

function lowest(...pts: AnglePoint[]): number {
  return Math.min(...pts.map((p) => p.visibility ?? 1));
}

/**
 * Unsigned interior angle at `b`, in degrees, 0..180, or null when either arm is degenerately short.
 *
 * atan2(|u x v|, u . v) rather than acos((u . v) / (|u||v|)). acos loses most of its precision near 0
 * and 180 degrees — exactly where a straightening knee lives — because its derivative blows up there
 * and a rounding error in the cosine becomes degrees of angle. The orphaned SessionStudio:585 uses
 * acos with a clamp; do not copy it.
 */
export function interiorAngleDeg(
  a: AnglePoint,
  b: AnglePoint,
  c: AnglePoint,
  { aspect = 1, use3d = false }: AngleOptions = {},
): number | null {
  const ux = (a.x - b.x) * aspect;
  const uy = a.y - b.y;
  const uz = use3d ? (a.z ?? 0) - (b.z ?? 0) : 0;
  const vx = (c.x - b.x) * aspect;
  const vy = c.y - b.y;
  const vz = use3d ? (c.z ?? 0) - (b.z ?? 0) : 0;

  const lu = Math.hypot(ux, uy, uz);
  const lv = Math.hypot(vx, vy, vz);
  if (!(lu >= MIN_SEGMENT_LENGTH) || !(lv >= MIN_SEGMENT_LENGTH)) return null;

  const dot = ux * vx + uy * vy + uz * vz;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const deg = Math.atan2(Math.hypot(cx, cy, cz), dot) * DEG;
  return Number.isFinite(deg) ? deg : null;
}

/**
 * KNEE FLEXION from hip-knee-ankle: 180 minus the interior angle at the knee. 0 = straight leg,
 * larger = more bent. See the header for why this direction.
 */
export function readKneeFlexion(
  landmarks: readonly AnglePoint[],
  side: VisionSide,
  opts: AngleOptions = {},
): AngleReading {
  const min = opts.minVisibility ?? MIN_LANDMARK_VISIBILITY;
  const names: AngleLandmarkName[] = [
    pick(side, "leftHip", "rightHip"),
    pick(side, "leftKnee", "rightKnee"),
    pick(side, "leftAnkle", "rightAnkle"),
  ];
  const points: AnglePoint[] = [];
  for (const name of names) {
    const r = check(landmarks, name, min);
    if ("rejected" in r) return fail(r.rejected, name);
    points.push(r.point);
  }
  const interior = interiorAngleDeg(points[0], points[1], points[2], opts);
  if (interior === null) return fail("degenerate", null);
  return ok(180 - interior, lowest(...points));
}

/**
 * THIGH ELEVATION from hip -> knee against the image horizontal. Signed, -90..90; image y grows
 * downward, hence the negation. This is the straight-leg-raise signal (exerciseConfigs.ts:70 records
 * targetValueDeg 30 as "thigh elevation"), and it is also what the two lying-partial raises target.
 * It is a camera-frame elevation: it means nothing if the camera is not level and side-on.
 */
export function readThighElevation(
  landmarks: readonly AnglePoint[],
  side: VisionSide,
  { aspect = 1, minVisibility = MIN_LANDMARK_VISIBILITY, use3d = false }: AngleOptions = {},
): AngleReading {
  const names: AngleLandmarkName[] = [
    pick(side, "leftHip", "rightHip"),
    pick(side, "leftKnee", "rightKnee"),
  ];
  const points: AnglePoint[] = [];
  for (const name of names) {
    const r = check(landmarks, name, minVisibility);
    if ("rejected" in r) return fail(r.rejected, name);
    points.push(r.point);
  }
  const [hip, knee] = points;
  const dx = (knee.x - hip.x) * aspect;
  const dy = -(knee.y - hip.y); // up-positive
  const dz = use3d ? (knee.z ?? 0) - (hip.z ?? 0) : 0;
  const len = Math.hypot(dx, dy, dz);
  if (!(len >= MIN_SEGMENT_LENGTH)) return fail("degenerate", null);
  return ok(Math.asin(dy / len) * DEG, lowest(hip, knee));
}

/**
 * ANKLE angle from knee-ankle-foot_index: the interior angle at the ankle, near 90-110 degrees at a
 * neutral foot and smaller as the foot dorsiflexes. Returned RAW, not as dorsiflexion degrees — there
 * is no anatomical neutral to subtract without calibration, exactly as with the IMU proxy. Feed it to
 * lib/motion/flexion's createProxyOrienter, which takes the zero from the first 500 ms and orients by
 * the larger excursion; that is what turns it into a rest-at-zero, movement-positive signal.
 *
 * Falls back to the heel when foot_index is not confidently tracked — bare toes under a blanket, or a
 * foot too small in frame at 2-3 m. The heel is a shorter lever, so the same movement reads as fewer
 * degrees; that is acceptable only because the orienter re-zeroes and the counter works on excursions,
 * and it is another reason the raw number is never shown as dorsiflexion.
 */
export function readAnkleInterior(
  landmarks: readonly AnglePoint[],
  side: VisionSide,
  opts: AngleOptions = {},
): AngleReading {
  const min = opts.minVisibility ?? MIN_LANDMARK_VISIBILITY;
  const kneeName = pick(side, "leftKnee", "rightKnee");
  const ankleName = pick(side, "leftAnkle", "rightAnkle");
  const toeName = pick(side, "leftFootIndex", "rightFootIndex");
  const heelName = pick(side, "leftHeel", "rightHeel");

  const kneeR = check(landmarks, kneeName, min);
  if ("rejected" in kneeR) return fail(kneeR.rejected, kneeName);
  const ankleR = check(landmarks, ankleName, min);
  if ("rejected" in ankleR) return fail(ankleR.rejected, ankleName);

  const toeR = check(landmarks, toeName, min);
  const heelR = check(landmarks, heelName, min);
  const distal = "point" in toeR ? toeR.point : "point" in heelR ? heelR.point : null;
  // Report the toe, not the heel: the toe is the point the patient has to bring into frame.
  if (!distal) return fail("rejected" in toeR ? toeR.rejected : "missing", toeName);

  const interior = interiorAngleDeg(kneeR.point, ankleR.point, distal, opts);
  if (interior === null) return fail("degenerate", null);
  return ok(interior, lowest(kneeR.point, ankleR.point, distal));
}

/** One entry point, so a stage does not switch on the kind at every call site. */
export function readJointAngle(
  kind: JointAngleKind,
  landmarks: readonly AnglePoint[],
  side: VisionSide,
  opts: AngleOptions = {},
): AngleReading {
  if (kind === "knee") return readKneeFlexion(landmarks, side, opts);
  if (kind === "thigh") return readThighElevation(landmarks, side, opts);
  return readAnkleInterior(landmarks, side, opts);
}

// The thin wrappers below are for callers that only want the number. They are one line each on purpose:
// there is exactly one implementation of every angle, and it is the read* function above.

export function kneeFlexionDeg(
  landmarks: readonly AnglePoint[],
  side: VisionSide,
  opts: AngleOptions = {},
): AngleSample | null {
  return readKneeFlexion(landmarks, side, opts).sample;
}

export function thighElevationDeg(
  landmarks: readonly AnglePoint[],
  side: VisionSide,
  opts: AngleOptions = {},
): AngleSample | null {
  return readThighElevation(landmarks, side, opts).sample;
}

export function ankleInteriorDeg(
  landmarks: readonly AnglePoint[],
  side: VisionSide,
  opts: AngleOptions = {},
): AngleSample | null {
  return readAnkleInterior(landmarks, side, opts).sample;
}

export function jointAngleDeg(
  kind: JointAngleKind,
  landmarks: readonly AnglePoint[],
  side: VisionSide,
  opts: AngleOptions = {},
): AngleSample | null {
  return readJointAngle(kind, landmarks, side, opts).sample;
}

/**
 * The three landmark indices an angle is drawn from, for the on-canvas arc. "thigh" has only two real
 * points, so its first index repeats the hip: the caller draws no arc when the first two are equal.
 */
export function angleChain(kind: JointAngleKind, side: VisionSide): [number, number, number] {
  const L = ANGLE_LANDMARKS;
  const left = side === "left";
  if (kind === "knee") {
    return left ? [L.leftHip, L.leftKnee, L.leftAnkle] : [L.rightHip, L.rightKnee, L.rightAnkle];
  }
  if (kind === "thigh") {
    return left ? [L.leftHip, L.leftHip, L.leftKnee] : [L.rightHip, L.rightHip, L.rightKnee];
  }
  return left
    ? [L.leftKnee, L.leftAnkle, L.leftFootIndex]
    : [L.rightKnee, L.rightAnkle, L.rightFootIndex];
}

/**
 * Median of the last three accepted samples. Run this BEFORE the exponential smoother: one landmark
 * that jumps for a single frame produces a spike the EMA would smear across its whole time constant,
 * whereas the median removes it outright. Returns null until three samples have arrived.
 */
export function createMedian3(): (value: number) => number | null {
  const ring: number[] = [];
  return (value) => {
    if (!Number.isFinite(value)) return null;
    ring.push(value);
    if (ring.length > 3) ring.shift();
    if (ring.length < 3) return null;
    const sorted = ring.slice().sort((a, b) => a - b);
    return sorted[1];
  };
}

/**
 * Time-constant exponential smoothing, frame-rate independent: weighting by elapsed time rather than
 * per sample keeps the readout equally smooth whether the detection loop is running at 15 or 60 fps.
 *
 * This is a deliberate copy of createSmoother in src/lib/motion/legGuide.ts:56-70 (same algorithm, same
 * 90 ms default, same "a non-finite sample leaves the value unchanged" rule). It is duplicated rather
 * than imported because this file is executed directly by node --test, which cannot resolve the "@/"
 * alias and needs a ".ts" specifier that tsc rejects — the constraint lib/motion/flexion.ts:50-52
 * states. If legGuide's version ever changes, change this one with it.
 */
export function createAngleSmoother(timeConstantMs = 90): (sample: number, now: number) => number {
  let value: number | null = null;
  let lastAt = 0;
  return (sample, now) => {
    if (!Number.isFinite(sample) || !Number.isFinite(now)) return value ?? Number.NaN;
    if (value === null) {
      value = sample;
      lastAt = now;
      return value;
    }
    const dt = Math.max(0, now - lastAt);
    lastAt = now;
    value += (sample - value) * (1 - Math.exp(-dt / timeConstantMs));
    return value;
  };
}
