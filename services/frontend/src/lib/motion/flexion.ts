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
 * Where the zero is taken. The live orienter zeroes on the first PROXY_BASELINE_MS of pairs after each
 * reset and reports that span as `baselineWindow`. The exercise screen resets it on every start, and a
 * reload starts a new count, so a session can hold several starts, each on its own zero, and the zero is
 * not at the beginning of the stored frames. Given the saved windows, buildStoredProxySeries splits the
 * stored pairs at each start, zeroes each part on its own window and leaves the pairs before the first
 * start out of the count; without any, the recount zeroes on the first PROXY_BASELINE_MS of stored pairs,
 * which is only the live zero when the session had a single uninterrupted start.
 *
 * Known limitation: a session that starts bent (pinned by recount.test.ts, so that changing it is a
 * deliberate decision and not a side effect). The zero is whatever pose the leg holds during the baseline
 * window; nothing here can tell a straight leg from a bent one, which is what calibration (#17) is for,
 * and the screen can only ask for a straight, still leg. Say the zero is taken with the leg bent by B
 * proxy degrees relative to the rest pose the patient then returns to between reps, and each rep bends P
 * past that rest. Straightening after the baseline is then an excursion of B one way, and each rep an
 * excursion of P - B the other way; the larger excursion is taken as the bend (orientationOf).
 *  - P at least about 2B: the direction ends up right. Live, it only turns right once the first rep has
 *    gone past B; until then rest reads +B and the bend reads down toward zero. If B >= enterDeg, the live
 *    counter opens a rep as the leg straightens after the baseline and completes it as the leg passes the
 *    baseline pose on the way into the first real bend: one phantom rep on the patient's screen. orientProxySeries
 *    applies the final direction to every sample, so the recount does not have it (with enterDeg 22.5 and
 *    P = 70: B = 25 counts 11 live and 10 stored; B = 20 counts 10 and 10).
 *  - P below about 2B: the direction never turns right, in either form, and the whole session reads
 *    inverted. Rest reads +B and a rep's peak reads B - P, so the guide draws the leg bent while it lies
 *    straight, and what gets counted are the rests between bends (P = 70, B = 40: 10 and 10, inverted).
 *    If B is also under enterDeg nothing is ever entered (P = 30, B = 16: 0 and 0 for ten real slides).
 * An ordinary extension deficit does not trigger any of this: B is measured against the rest the patient
 * returns to, not against a straight knee.
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

/**
 * The span of sample time a zero was taken over: `startMs` inclusive, `endMs` exclusive. It is on the
 * samples' clock, which on the exercise screen and in session_frames is the receive time in epoch ms.
 */
export interface BaselineWindow {
  startMs: number;
  endMs: number;
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
  /**
   * The span the current zero was taken over: from the first sample after the last reset, `baselineMs`
   * long. Null until ready. Saved with the session, it lets buildStoredProxySeries recount on this zero.
   */
  readonly baselineWindow: BaselineWindow | null;
}

/**
 * Live orientation, without knowing how the sensors are mounted or which leg they are on.
 *
 * The zero is the median of the first `baselineMs` of samples, taken while the leg is straight. After
 * that, the larger excursion seen so far is the bend (Phoenix's live rule). A heel slide bends much
 * further than a knee hyperextends, so the first real bend settles the direction; before it, values
 * stay small either way. Hyperextension reads negative and a large bend is not capped. A zero taken
 * while the leg was bent breaks the "values stay small" part; see the limitation in the header.
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
    get baselineWindow() {
      if (baseline === null || windowStartMs === null) return null;
      return { startMs: windowStartMs, endMs: windowStartMs + baselineMs };
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
 * Zeroes time-ordered finite samples on the median of their first `windowCount` and orients all of them
 * by the larger excursion. An empty window gives no zero and no samples.
 */
function orientOnLeadingWindow(finite: readonly ProxySample[], windowCount: number): OrientedProxySeries {
  const count = Math.min(windowCount, finite.length);
  if (count < 1) return { samples: [], baselineDeg: null, orientation: 1, baselineSampleCount: 0 };
  const baseline = circularMedianDeg(finite.slice(0, count).map((sample) => sample.value));

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
    baselineSampleCount: count,
  };
}

/**
 * The live orienter's rules in batch form, for a whole recorded series in time order. Same zero (median
 * of the first `baselineMs`); the orientation is the one the live orienter holds at the end, applied to
 * every sample, including the baseline window. The two therefore agree once the direction has settled,
 * and differ before a change of direction, which only a bent start produces (see the header). A series
 * shorter than the window is zeroed on all of it. Non-finite samples are dropped.
 */
export function orientProxySeries(
  samples: readonly ProxySample[],
  { baselineMs = PROXY_BASELINE_MS }: { baselineMs?: number } = {},
): OrientedProxySeries {
  const finite = samples.filter((sample) => Number.isFinite(sample.tMs) && Number.isFinite(sample.value));
  const startMs = finite.length ? finite[0].tMs : 0;
  let windowEnd = 0;
  while (windowEnd < finite.length && finite[windowEnd].tMs - startMs < baselineMs) windowEnd += 1;
  return orientOnLeadingWindow(finite, Math.max(1, windowEnd));
}

export interface PairedProxySample {
  /** When both readings were known: the later of the two timestamps. */
  tMs: number;
  relativeDeg: number;
  /** Time between the thigh and shank readings that were combined. */
  skewMs: number;
}

export interface ProxyPairer {
  /** Feed any role's reading; returns a paired sample when the signal's segments are both fresh enough. */
  push(role: SensorRole, tMs: number, pitchDeg: number): PairedProxySample | null;
  reset(): void;
}

/**
 * Which orientation signal carries an exercise's movement, in the same two shapes PHOENIX's
 * `exercise_signals.SignalSpec` uses (services/imu-tools/src/mova_imu/analysis/exercise_signals.py):
 *
 *  - `relative`: one segment's pitch minus another's, written distal minus proximal. Heel Slide's knee bend is
 *    shank minus thigh; an ankle pump is foot minus shank.
 *  - `absolute`: one segment's own pitch. A straight leg raise needs this and only this: the knee stays straight,
 *    so every segment-pair difference stays near zero and the lift shows up only in the thigh's own angle. Pairing
 *    thigh and shank for that exercise would measure a knee bend that is not the movement being asked for.
 *
 * Yaw is never a choice here for the same reason exercise_signals.py refuses it: without a magnetometer it drifts.
 */
export type FlexionSignal =
  | { kind: "relative"; distal: SensorRole; proximal: SensorRole }
  | { kind: "absolute"; role: SensorRole };

/** Heel Slide's signal, and the default for every knee-flexion exercise. */
export const KNEE_SIGNAL: FlexionSignal = { kind: "relative", distal: "shank", proximal: "thigh" };

/** The sensor roles a signal needs before it can produce a sample. Counting pauses while any of them is missing. */
export function signalRoles(signal: FlexionSignal): SensorRole[] {
  return signal.kind === "relative" ? [signal.proximal, signal.distal] : [signal.role];
}

/**
 * How a signal is written down, in the same words PROXY_DEFINITION uses, so a stored count always says what it was
 * counted on. PROXY_DEFINITION itself is left untouched: it is written into every Heel Slide summary already and the
 * clinician recount reads it back.
 */
export function signalDefinition(signal: FlexionSignal): string {
  const measured =
    signal.kind === "relative"
      ? `wrap(${signal.distal}.pitch - ${signal.proximal}.pitch)`
      : `${signal.role}.pitch`;
  return `${measured}, baseline-zeroed, oriented`;
}

/**
 * Live pairing for any signal. The three sensors notify on independent BLE links, so there is no shared frame to
 * read both segments from: each new reading from one of the signal's segments is combined with the other's latest,
 * unless the two are more than `maxSkewMs` apart. A reading from a role the signal does not use is ignored.
 *
 * An absolute signal has nothing to pair with, so every finite reading from its role is a sample with zero skew.
 */
export function createSignalPairer(
  signal: FlexionSignal,
  maxSkewMs: number = DEFAULT_MAX_PAIR_SKEW_MS,
): ProxyPairer {
  if (signal.kind === "absolute") {
    const { role } = signal;
    return {
      push(pushedRole, tMs, pitchDeg) {
        if (pushedRole !== role) return null;
        if (!Number.isFinite(tMs) || !Number.isFinite(pitchDeg)) return null;
        return { tMs, relativeDeg: wrapDeg(pitchDeg), skewMs: 0 };
      },
      reset() {
        /* an absolute signal holds no state between samples */
      },
    };
  }

  const { distal, proximal } = signal;
  let distalReading: { tMs: number; pitchDeg: number } | null = null;
  let proximalReading: { tMs: number; pitchDeg: number } | null = null;

  return {
    push(role, tMs, pitchDeg) {
      if (!Number.isFinite(tMs) || !Number.isFinite(pitchDeg)) return null;
      if (role === distal) distalReading = { tMs, pitchDeg };
      else if (role === proximal) proximalReading = { tMs, pitchDeg };
      else return null;
      if (distalReading === null || proximalReading === null) return null;
      const skewMs = Math.abs(distalReading.tMs - proximalReading.tMs);
      if (skewMs > maxSkewMs) return null;
      return {
        tMs: Math.max(distalReading.tMs, proximalReading.tMs),
        relativeDeg: relativePitchDeg(proximalReading.pitchDeg, distalReading.pitchDeg),
        skewMs,
      };
    },
    reset() {
      distalReading = null;
      proximalReading = null;
    },
  };
}

/**
 * Heel Slide's pairer: shank minus thigh, foot readings ignored. Kept as its own name because it is what the
 * shipping screen, the stored summaries and the clinician recount are all written against.
 */
export function createPairer(maxSkewMs: number = DEFAULT_MAX_PAIR_SKEW_MS): ProxyPairer {
  return createSignalPairer(KNEE_SIGNAL, maxSkewMs);
}

/** One stored reading as the clinician RPC returns it: [epoch ms, pitch degrees]. Pitch may be missing. */
export type StoredPitchPoint = readonly [tMs: number, pitchDeg: number | null];

export interface PairingStats {
  thighSamples: number;
  shankSamples: number;
  pairs: number;
  /** Shank readings with no thigh reading within the allowed skew; they are left out of the series. */
  unpairedShank: number;
  /**
   * Skew over the pairs only, so never more than the pairing tolerance (`maxSkewMs`): a shank reading further from
   * every thigh reading is unpaired and not in these. This is the recount's tolerance at work, not the skew between
   * the sensors; that needs every shank reading measured against its nearest thigh reading, without a cap.
   */
  medianSkewMs: number | null;
  maxSkewMs: number | null;
}

/** One start: the stored pairs from its saved zero window up to the next start. */
export interface StoredStart {
  /** The saved window this start's zero was taken over. */
  window: BaselineWindow;
  /** Stored pairs from this window's start up to the next start's window start, or to the last pair. */
  pairs: number;
  /**
   * Those pairs zeroed on this start's window and oriented over this start alone, as the live orienter did after
   * that reset. Empty when no stored pair falls inside the window, since there is no zero to count on. Count these.
   */
  samples: ProxySample[];
  baselineDeg: number | null;
  orientation: 1 | -1;
  baselineSampleCount: number;
  /**
   * Only when the window held no stored pair: the same pairs zeroed on their own first `baselineMs` and oriented by
   * the larger excursion, so they can still be drawn. Never count these.
   */
  uncounted: ProxySample[];
}

export interface StoredProxySeries extends OrientedProxySeries {
  /** Covers every stored pair, counted or not. */
  pairing: PairingStats;
  /**
   * "window": zeroed on the saved windows, one start each (`starts`). "first_samples": no usable window was given, so
   * there is one span, zeroed on the first `baselineMs` of pairs, and `starts` is empty.
   *
   * The top-level samples, zero and orientation are every pair's with "first_samples" and the latest start's with
   * "window" (the start a device count after a reload covers). A session with several starts is counted per start,
   * on each `starts[i].samples`, and the counts added.
   */
  baselineSource: "window" | "first_samples";
  starts: StoredStart[];
  /**
   * Pairs earlier than the first start's window, for drawing only: they belong to no start and must not be counted.
   * On the first start's zero and orientation, or, when that window held no stored pair, on their own first
   * `baselineMs` (then `beforeBaselineOwnZero` is true). Empty without a window.
   */
  beforeBaselineWindow: ProxySample[];
  beforeBaselineOwnZero: boolean;
}

function finitePoints(points: readonly StoredPitchPoint[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [tMs, pitchDeg] of points) {
    if (Number.isFinite(tMs) && typeof pitchDeg === "number" && Number.isFinite(pitchDeg)) out.push([tMs, pitchDeg]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function usableWindow(window: BaselineWindow | null | undefined): BaselineWindow | null {
  if (!window || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs)) return null;
  return window.endMs > window.startMs ? { startMs: window.startMs, endMs: window.endMs } : null;
}

/** The usable windows in time order, one per start time. */
function usableWindows(windows: readonly (BaselineWindow | null | undefined)[]): BaselineWindow[] {
  const usable = windows
    .map(usableWindow)
    .filter((window): window is BaselineWindow => window !== null)
    .sort((a, b) => a.startMs - b.startMs);
  return usable.filter((window, i) => i === 0 || window.startMs !== usable[i - 1].startMs);
}

/**
 * Stored per-role pitch series to the oriented proxy, for recounting a finished session.
 *
 * Each shank reading is paired with the thigh reading nearest in time (a thigh reading may serve more
 * than one shank reading when frames were dropped); pairs further apart than `maxSkewMs` are skipped
 * and counted. Pair times are never decreasing. At the edges of a dropout they fall where the live
 * pairer's do; in between, the live pairer also pairs on thigh readings, so the two pair sets are close
 * rather than identical, and a pause within about `maxSkewMs` of reps.ts MAX_REP_GAP_MS can be judged
 * differently by the two.
 *
 * The zero. `baselineWindows` are the live orienter's windows, one per start, saved with the session. A single
 * `baselineWindow` (what older sessions saved: the latest start's) is used only when `baselineWindows` holds no
 * usable window. The pairs are split where each window starts: a start runs from its window's start up to the next
 * window's start. Each start is zeroed on the median of its pairs inside its own window and oriented by
 * orientProxySeries' rule over its own pairs, as the live orienter is after each reset. A start whose window holds no
 * stored pair has nothing to zero on: its `samples` are empty and `uncounted` carries its pairs for drawing. Pairs
 * before the first window come back in `beforeBaselineWindow`, not counted. Without a usable window (none, a
 * non-finite bound, or an end not after the start) the zero is the first `baselineMs` of pairs, as orientProxySeries
 * takes it. Count reps with reps.ts countOrientedRepetitions, per start, not countRepetitions, which would zero the
 * samples a second time.
 */
export function buildStoredProxySeries(
  series: { thigh: readonly StoredPitchPoint[]; shank: readonly StoredPitchPoint[] },
  {
    maxSkewMs = DEFAULT_MAX_PAIR_SKEW_MS,
    baselineMs = PROXY_BASELINE_MS,
    baselineWindow,
    baselineWindows,
  }: {
    maxSkewMs?: number;
    baselineMs?: number;
    baselineWindow?: BaselineWindow | null;
    baselineWindows?: readonly (BaselineWindow | null | undefined)[] | null;
  } = {},
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
  const pairing: PairingStats = {
    thighSamples: thigh.length,
    shankSamples: shank.length,
    pairs: paired.length,
    unpairedShank,
    medianSkewMs: skews.length ? median(skews) : null,
    maxSkewMs: skews.length ? skews[skews.length - 1] : null,
  };

  let windows = usableWindows(baselineWindows ?? []);
  if (!windows.length) windows = usableWindows([baselineWindow]);
  if (!windows.length) {
    return {
      ...orientProxySeries(paired, { baselineMs }),
      pairing,
      baselineSource: "first_samples",
      starts: [],
      beforeBaselineWindow: [],
      beforeBaselineOwnZero: false,
    };
  }

  // The index of each start's first pair; the extra last entry closes the latest start.
  const bounds: number[] = [];
  let cursor = 0;
  for (const window of windows) {
    while (cursor < paired.length && paired[cursor].tMs < window.startMs) cursor += 1;
    bounds.push(cursor);
  }
  bounds.push(paired.length);

  const starts = windows.map((window, i): StoredStart => {
    const span = paired.slice(bounds[i], bounds[i + 1]);
    let windowCount = 0;
    while (windowCount < span.length && span[windowCount].tMs < window.endMs) windowCount += 1;
    const zeroed = orientOnLeadingWindow(span, windowCount);
    const uncounted = zeroed.baselineDeg === null ? orientProxySeries(span, { baselineMs }).samples : [];
    return { window, pairs: span.length, ...zeroed, uncounted };
  });

  const before = paired.slice(0, bounds[0]);
  const first = starts[0];
  const firstZero = first.baselineDeg;
  const beforeBaselineWindow =
    firstZero === null
      ? orientProxySeries(before, { baselineMs }).samples
      : before.map((sample) => ({
          tMs: sample.tMs,
          value: oriented(first.orientation, wrapDeg(sample.value - firstZero)),
        }));
  const latest = starts[starts.length - 1];
  return {
    samples: latest.samples,
    baselineDeg: latest.baselineDeg,
    orientation: latest.orientation,
    baselineSampleCount: latest.baselineSampleCount,
    pairing,
    baselineSource: "window",
    starts,
    beforeBaselineWindow,
    beforeBaselineOwnZero: before.length > 0 && firstZero === null,
  };
}
