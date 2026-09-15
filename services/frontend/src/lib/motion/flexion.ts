import type { SensorRole } from "@/lib/ble/roles";

/**
 * The heel-slide motion proxy, and the two ways sensor readings become it: live, one BLE frame at a
 * time on the exercise screen, and in batch from stored frames for the clinician view.
 *
 * The proxy is wrap(shank pitch - thigh pitch): how differently the two sensors are tilted about their
 * pitch axis. It is a relative device-orientation reading. It is not a knee angle, it is uncalibrated
 * (nothing aligns a sensor to its limb segment), and it must never be shown as degrees of knee flexion
 * or turned into a score. It drives the rep counter (reps.ts) and the drawn leg (legGuide.ts).
 *
 * Ported from Phoenix (services/api/app/reps.py, apps/patient-web/src/kneeAngle.ts) with deliberate
 * differences:
 *  - The signal is fixed: shank minus thigh, pitch (eulerDegrees[1]). Phoenix auto-selects the segment
 *    pair and roll vs pitch by the largest excursion, and its live guide used roll. Fixing it means the
 *    live counter and the clinician recount can never pick different signals. Whether pitch is the axis
 *    that moves on the real mounting is on the hardware checklist in docs/heel-slide-path.md.
 *  - The difference is always wrapped into (-180, 180]. Phoenix origin/main subtracted bare, so a
 *    sensor resting on the +/-180 seam jumped by 360 degrees and read as a huge bend (seam.test.ts).
 *  - No gain and no clamp to a knee scale. Phoenix's live guide multiplied by FLEXION_GAIN = 3 and
 *    clamped to 0-120 so the number looked like knee flexion. Here the proxy stays what it measures;
 *    the only clamp is legGuide.ts's, and that one is for drawing.
 *
 * No runtime imports from sibling modules: node:test runs these sources directly, which needs `.ts`
 * import paths, and tsc here rejects those. Siblings share types only.
 */

/** Index into ParsedWt901Frame.eulerDegrees, which is [roll, pitch, yaw]. Fixed to pitch; see above. */
export const FLEXION_PROXY_AXIS = 1;

/** Stored with a session's counts, so a number always says what it was counted on. */
export const PROXY_DEFINITION = "wrap(shank.pitch - thigh.pitch), baseline-zeroed, oriented";

/** The session starts with the leg straight and still; the median over this window is the zero. */
export const PROXY_BASELINE_MS = 500;

/** Thigh and shank readings further apart than this are not combined into one proxy sample. */
export const DEFAULT_MAX_PAIR_SKEW_MS = 100;

/** One proxy reading, in degrees of relative sensor orientation. */
export interface ProxySample {
  tMs: number;
  value: number;
}

export function wrapDeg(value: number): number {
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** The proxy component of a WT901 frame's Euler angles. */
export function proxyPitchDeg(eulerDegrees: readonly number[]): number {
  return eulerDegrees[FLEXION_PROXY_AXIS];
}

/** Shank pitch minus thigh pitch, wrapped. Not zeroed and not oriented. */
export function relativePitchDeg(thighPitchDeg: number, shankPitchDeg: number): number {
  return wrapDeg(shankPitchDeg - thighPitchDeg);
}

/** statistics.median semantics: the mean of the two middle values for an even count. */
function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Median of angles measured around the first one, so a rest pose on the +/-180 seam does not average
 * +179 and -179 into 0.
 */
function circularMedianDeg(values: readonly number[]): number {
  const reference = values[0];
  const offsets = values.map((value) => wrapDeg(value - reference)).sort((a, b) => a - b);
  return wrapDeg(reference + median(offsets));
}

/** Phoenix's `_oriented` sign rule: the larger excursion from the zero is the bend. Ties read as +1. */
function orientationOf(furthestAbove: number, furthestBelow: number): 1 | -1 {
  return furthestAbove >= furthestBelow ? 1 : -1;
}

/** Avoids handing out -0, which strict equality tells apart from 0. */
function oriented(orientation: 1 | -1, delta: number): number {
  return delta === 0 ? 0 : orientation * delta;
}

export interface ProxyOrienter {
  /**
   * The oriented proxy for this sample: zeroed on the baseline, wrapped, bend positive. Null while the
   * baseline window is still filling, and for a non-finite sample.
   */
  push(tMs: number, relativeDeg: number): number | null;
  /** Start over; the next sample opens a new baseline window. */
  reset(): void;
  readonly ready: boolean;
  readonly baselineDeg: number | null;
  /** Which way a bend moves the raw difference, as far as the movement so far shows. */
  readonly orientation: 1 | -1;
}

/**
 * Live orientation, without knowing how the sensors are mounted or which leg they are on.
 *
 * The zero is the median of the first `baselineMs` of samples, taken while the leg is straight. After
 * that, the larger excursion seen so far is the bend (Phoenix's live rule). A heel slide bends much
 * further than a knee hyperextends, so the first real bend settles the direction; before it, values
 * stay small either way. Hyperextension reads negative and a large bend is not capped.
 */
export function createProxyOrienter({ baselineMs = PROXY_BASELINE_MS }: { baselineMs?: number } = {}): ProxyOrienter {
  let windowStartMs: number | null = null;
  let windowValues: number[] = [];
  let baseline: number | null = null;
  let furthestAbove = 0;
  let furthestBelow = 0;

  const track = (relativeDeg: number, zero: number): number => {
    const delta = wrapDeg(relativeDeg - zero);
    if (delta > furthestAbove) furthestAbove = delta;
    if (-delta > furthestBelow) furthestBelow = -delta;
    return delta;
  };

  return {
    push(tMs, relativeDeg) {
      if (!Number.isFinite(tMs) || !Number.isFinite(relativeDeg)) return null;
      if (baseline === null) {
        if (windowStartMs === null) windowStartMs = tMs;
        if (tMs - windowStartMs < baselineMs) {
          windowValues.push(relativeDeg);
          return null;
        }
        baseline = circularMedianDeg(windowValues.length ? windowValues : [relativeDeg]);
        for (const value of windowValues) track(value, baseline);
        windowValues = [];
      }
      const delta = track(relativeDeg, baseline);
      return oriented(orientationOf(furthestAbove, furthestBelow), delta);
    },
    reset() {
      windowStartMs = null;
      windowValues = [];
      baseline = null;
      furthestAbove = 0;
      furthestBelow = 0;
    },
    get ready() {
      return baseline !== null;
    },
    get baselineDeg() {
      return baseline;
    },
    get orientation() {
      return orientationOf(furthestAbove, furthestBelow);
    },
  };
}

export interface OrientedProxySeries {
  /** Every input sample, zeroed on the baseline, wrapped, bend positive. */
  samples: ProxySample[];
  baselineDeg: number | null;
  orientation: 1 | -1;
  /** How many leading samples the baseline median was taken over. */
  baselineSampleCount: number;
}

/**
 * The live orienter's rules in batch form, for a whole recorded series in time order. Same zero (median
 * of the first `baselineMs`); the orientation is the one the live orienter holds at the end, applied to
 * every sample, including the baseline window. A series shorter than the window is zeroed on all of it.
 * Non-finite samples are dropped.
 */
export function orientProxySeries(
  samples: readonly ProxySample[],
  { baselineMs = PROXY_BASELINE_MS }: { baselineMs?: number } = {},
): OrientedProxySeries {
  const finite = samples.filter((sample) => Number.isFinite(sample.tMs) && Number.isFinite(sample.value));
  if (!finite.length) return { samples: [], baselineDeg: null, orientation: 1, baselineSampleCount: 0 };

  const startMs = finite[0].tMs;
  let windowEnd = 0;
  while (windowEnd < finite.length && finite[windowEnd].tMs - startMs < baselineMs) windowEnd += 1;
  const windowValues = finite.slice(0, Math.max(1, windowEnd)).map((sample) => sample.value);
  const baseline = circularMedianDeg(windowValues);

  let furthestAbove = 0;
  let furthestBelow = 0;
  const deltas = finite.map((sample) => {
    const delta = wrapDeg(sample.value - baseline);
    if (delta > furthestAbove) furthestAbove = delta;
    if (-delta > furthestBelow) furthestBelow = -delta;
    return delta;
  });
  const orientation = orientationOf(furthestAbove, furthestBelow);
  return {
    samples: finite.map((sample, index) => ({ tMs: sample.tMs, value: oriented(orientation, deltas[index]) })),
    baselineDeg: baseline,
    orientation,
    baselineSampleCount: windowValues.length,
  };
}

export interface PairedProxySample {
  /** When both readings were known: the later of the two timestamps. */
  tMs: number;
  relativeDeg: number;
  /** Time between the thigh and shank readings that were combined. */
  skewMs: number;
}

export interface ProxyPairer {
  /** Feed any role's reading; returns a paired sample when thigh and shank are both fresh enough. */
  push(role: SensorRole, tMs: number, pitchDeg: number): PairedProxySample | null;
  reset(): void;
}

/**
 * Live pairing. The three sensors notify on independent BLE links, so there is no shared frame to read
 * both segments from: each new thigh or shank reading is combined with the other segment's latest one,
 * unless the two are more than `maxSkewMs` apart. Foot readings are not part of the proxy and are ignored.
 */
export function createPairer(maxSkewMs: number = DEFAULT_MAX_PAIR_SKEW_MS): ProxyPairer {
  let thigh: { tMs: number; pitchDeg: number } | null = null;
  let shank: { tMs: number; pitchDeg: number } | null = null;

  return {
    push(role, tMs, pitchDeg) {
      if (!Number.isFinite(tMs) || !Number.isFinite(pitchDeg)) return null;
      if (role === "thigh") thigh = { tMs, pitchDeg };
      else if (role === "shank") shank = { tMs, pitchDeg };
      else return null;
      if (thigh === null || shank === null) return null;
      const skewMs = Math.abs(thigh.tMs - shank.tMs);
      if (skewMs > maxSkewMs) return null;
      return {
        tMs: Math.max(thigh.tMs, shank.tMs),
        relativeDeg: relativePitchDeg(thigh.pitchDeg, shank.pitchDeg),
        skewMs,
      };
    },
    reset() {
      thigh = null;
      shank = null;
    },
  };
}

/** One stored reading as the clinician RPC returns it: [epoch ms, pitch degrees]. Pitch may be missing. */
export type StoredPitchPoint = readonly [tMs: number, pitchDeg: number | null];

export interface PairingStats {
  thighSamples: number;
  shankSamples: number;
  pairs: number;
  /** Shank readings with no thigh reading within the allowed skew; they are left out of the series. */
  unpairedShank: number;
  medianSkewMs: number | null;
  maxSkewMs: number | null;
}

export interface StoredProxySeries extends OrientedProxySeries {
  pairing: PairingStats;
}

function finitePoints(points: readonly StoredPitchPoint[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [tMs, pitchDeg] of points) {
    if (Number.isFinite(tMs) && typeof pitchDeg === "number" && Number.isFinite(pitchDeg)) out.push([tMs, pitchDeg]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Stored per-role pitch series to the oriented proxy, for recounting a finished session.
 *
 * Each shank reading is paired with the thigh reading nearest in time (a thigh reading may serve more
 * than one shank reading when frames were dropped); pairs further apart than `maxSkewMs` are skipped
 * and counted. The series is then oriented with the live rules (orientProxySeries). Count reps on it
 * with reps.ts countOrientedRepetitions, not countRepetitions, which would zero it a second time.
 */
export function buildStoredProxySeries(
  series: { thigh: readonly StoredPitchPoint[]; shank: readonly StoredPitchPoint[] },
  {
    maxSkewMs = DEFAULT_MAX_PAIR_SKEW_MS,
    baselineMs = PROXY_BASELINE_MS,
  }: { maxSkewMs?: number; baselineMs?: number } = {},
): StoredProxySeries {
  const thigh = finitePoints(series.thigh);
  const shank = finitePoints(series.shank);
  const paired: ProxySample[] = [];
  const skews: number[] = [];
  let unpairedShank = 0;

  let latestNotAfter = 0;
  for (const [shankMs, shankPitch] of shank) {
    while (latestNotAfter + 1 < thigh.length && thigh[latestNotAfter + 1][0] <= shankMs) latestNotAfter += 1;
    let nearest = -1;
    let nearestSkew = Infinity;
    for (const candidate of [latestNotAfter, latestNotAfter + 1]) {
      if (candidate >= thigh.length) continue;
      const skew = Math.abs(thigh[candidate][0] - shankMs);
      if (skew < nearestSkew) {
        nearest = candidate;
        nearestSkew = skew;
      }
    }
    if (nearest < 0 || nearestSkew > maxSkewMs) {
      unpairedShank += 1;
      continue;
    }
    const [thighMs, thighPitch] = thigh[nearest];
    paired.push({ tMs: Math.max(thighMs, shankMs), value: relativePitchDeg(thighPitch, shankPitch) });
    skews.push(nearestSkew);
  }

  skews.sort((a, b) => a - b);
  return {
    ...orientProxySeries(paired, { baselineMs }),
    pairing: {
      thighSamples: thigh.length,
      shankSamples: shank.length,
      pairs: paired.length,
      unpairedShank,
      medianSkewMs: skews.length ? median(skews) : null,
      maxSkewMs: skews.length ? skews[skews.length - 1] : null,
    },
  };
}
