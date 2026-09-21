// Per-repetition features, read off the oriented proxy trace the rep counter already produced.
//
// `reps.RepSegment` says only where a repetition started, peaked and ended. The scoring engine's `RepResult`
// (lib/scoring/types.ts) wants rather more: how long the rep took, how long the patient held at the top, how long the
// return took, and how far it actually went. Those are all readable from the samples inside the segment, so they are
// measured here rather than estimated anywhere else.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO:
//  - it does not compute smoothness. That needs the jerk math in lib/scoring/kinematics.ts, which is a runtime import
//    this module may not make (see the node:test rule in flexion.ts's header). The caller composes the two.
//  - it does not decide whether a rep counts toward Volume beyond the excursion test. A rep lost to a sensor dropout
//    is known only to the screen that watched the sensors drop, so the caller passes that in.
//  - it does not turn the proxy's degrees into knee degrees. They are not the same unit and nothing here pretends
//    otherwise; lib/motion/flexion.ts's header explains why.
//
// Pure, with type-only imports, so `npm run test:unit` runs this source directly.

import type { ProxySample } from "./flexion";
import type { RepSegment } from "./reps";

/**
 * A sample counts as "at the top" while it stays within this fraction of the peak. 10% is an engineering choice, not
 * a clinical one: PHOENIX measures `hold_seconds` from its own segmentation rather than from a tolerance band, and no
 * source in this repo states a band. It is named and exported so it can be changed in one place once one does.
 */
export const HOLD_BAND_FRACTION = 0.1;

export interface RepFeatures {
  startedAtMs: number;
  endedAtMs: number;
  /** Largest oriented proxy value inside the rep, in relative sensor-orientation degrees. */
  peakExcursionDeg: number;
  /** Whole-rep duration, seconds. */
  tempoSec: number;
  /** Seconds spent within HOLD_BAND_FRACTION of the peak, measured across the contiguous run containing the peak. */
  holdSec: number;
  /** Seconds from leaving that band to the end of the rep. Undefined when the rep has no samples after the hold. */
  returnDurationSec?: number;
  /** The samples inside the rep, in time order — what a smoothness or trajectory reader needs. */
  samples: ProxySample[];
}

/** The samples of one repetition, in time order, both ends inclusive. */
export function samplesInRep(samples: readonly ProxySample[], rep: RepSegment): ProxySample[] {
  return samples
    .filter((sample) => sample.tMs >= rep.startMs && sample.tMs <= rep.endMs && Number.isFinite(sample.value))
    .sort((a, b) => a.tMs - b.tMs)
    .map(({ tMs, value }) => ({ tMs, value }));
}

/**
 * Features for one repetition.
 *
 * The hold is measured over the contiguous run of samples around the peak that stay inside the band, not over every
 * sample in the rep that happens to be high: a rep that touched the top twice held once, briefly, and reporting the
 * sum of both would flatter it.
 */
export function repFeatures(samples: readonly ProxySample[], rep: RepSegment): RepFeatures {
  const inside = samplesInRep(samples, rep);
  const tempoSec = Math.max(0, (rep.endMs - rep.startMs) / 1000);

  if (inside.length === 0) {
    return {
      startedAtMs: rep.startMs,
      endedAtMs: rep.endMs,
      peakExcursionDeg: rep.peakValue,
      tempoSec,
      holdSec: 0,
      samples: [],
    };
  }

  const peak = Math.max(rep.peakValue, ...inside.map((sample) => sample.value));
  const floor = peak - Math.abs(peak) * HOLD_BAND_FRACTION;

  // The run of samples around the peak that never leaves the band.
  let peakIndex = 0;
  for (let i = 1; i < inside.length; i += 1) {
    if (inside[i].value > inside[peakIndex].value) peakIndex = i;
  }
  let first = peakIndex;
  while (first > 0 && inside[first - 1].value >= floor) first -= 1;
  let last = peakIndex;
  while (last < inside.length - 1 && inside[last + 1].value >= floor) last += 1;

  const holdSec = Math.max(0, (inside[last].tMs - inside[first].tMs) / 1000);
  const afterHoldMs = rep.endMs - inside[last].tMs;
  const returnDurationSec = last < inside.length - 1 ? Math.max(0, afterHoldMs / 1000) : undefined;

  return {
    startedAtMs: rep.startMs,
    endedAtMs: rep.endMs,
    peakExcursionDeg: peak,
    tempoSec,
    holdSec,
    returnDurationSec,
    samples: inside,
  };
}

/**
 * Whether a repetition counts toward Volume: it cleared the exercise's smallest counting excursion and was not lost
 * to a sensor dropout. Target attainment is deliberately irrelevant — a rep short of its target still counts, per the
 * scoring spec §1 step 3, and lib/scoring/types.ts's RepResult says the same.
 */
export function countsTowardVolume(
  peakExcursionDeg: number,
  minValidExcursionDeg: number,
  lost: boolean,
): boolean {
  return !lost && Number.isFinite(peakExcursionDeg) && peakExcursionDeg >= minValidExcursionDeg;
}
