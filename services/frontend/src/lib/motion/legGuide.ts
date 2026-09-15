/**
 * Geometry and smoothing for the heel-slide guide: the side-view leg on the exercise screen that bends
 * as the patient moves.
 *
 * Ported from Phoenix apps/patient-web/src/kneeAngle.ts (heelSlidePose, createSmoother). The angle the
 * figure is drawn at comes from the oriented proxy in flexion.ts, clamped by drawAngleDeg so the figure
 * stays drawable. That makes it a picture that follows the sensors, not a knee-angle measurement: the
 * clamped value is never displayed, stored or compared with a goal. Phoenix's goal pose, degree readout
 * and "reached" state presented the proxy as knee flexion and are not ported.
 */

export interface Point {
  x: number;
  y: number;
}

/** Past this the drawn heel would slide into the hip; the figure stops bending here. */
export const GUIDE_MAX_DRAW_DEG = 120;

/** The oriented proxy as a drawing angle: 0 (straight) to GUIDE_MAX_DRAW_DEG. Unknown draws straight. */
export function drawAngleDeg(orientedProxyDeg: number | null): number {
  if (orientedProxyDeg === null || !Number.isFinite(orientedProxyDeg)) return 0;
  return Math.min(GUIDE_MAX_DRAW_DEG, Math.max(0, orientedProxyDeg));
}

/**
 * Side view of a heel slide in SVG coordinates (y grows downward): the patient lies on their back, the
 * hip stays put and the heel slides along the bed toward it as the leg bends. With the heel pinned to
 * the bed line, the knee follows from the two segment lengths and the drawing angle alone.
 */
export function heelSlidePose(
  bendDeg: number,
  hip: Point,
  thighLength: number,
  shankLength: number,
): { knee: Point; foot: Point } {
  const bend = (Math.max(0, bendDeg) * Math.PI) / 180;
  // The angle at the knee is 180 - bend, so by the law of cosines:
  const hipToFoot = Math.sqrt(thighLength ** 2 + shankLength ** 2 + 2 * thighLength * shankLength * Math.cos(bend));
  const cosHip = (thighLength ** 2 + hipToFoot ** 2 - shankLength ** 2) / (2 * thighLength * hipToFoot);
  const hipAngle = Math.acos(Math.min(1, Math.max(-1, cosHip)));
  return {
    knee: {
      x: hip.x + thighLength * Math.cos(hipAngle),
      y: hip.y - thighLength * Math.sin(hipAngle),
    },
    foot: { x: hip.x + hipToFoot, y: hip.y },
  };
}

/**
 * Time-constant exponential smoothing. Sensor angles jitter by a degree or two and BLE notifications
 * arrive unevenly; weighting by elapsed time rather than per sample keeps the leg equally smooth at any
 * frame or notification rate. A non-finite sample or timestamp leaves the value unchanged.
 */
export function createSmoother(timeConstantMs = 90): (sample: number, now: number) => number {
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
