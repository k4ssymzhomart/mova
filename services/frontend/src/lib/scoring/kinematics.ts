// Shared kinematic helpers for correctnessScore.ts. These sub-score formulas are NOT given by
// docs/PHOENIX_8_Exercises_Targets (1).docx — the spec gives weights per exercise (e.g. Heel Slide:
// smoothness 30%, tempo 25%, controlled return 20%, consistency 15%, hold 10%) and qualitative
// descriptions, but not the underlying math. These are defensible, documented engineering
// approximations pending clinical validation — same honesty convention lib/ble/signalQuality.ts already
// uses for its own thresholds ("need protocol-specific/clinical validation before real use").

export interface AngleSample {
  tMs: number;
  angleDeg: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 0..1 smoothness from a normalized-jerk-style metric: RMS of the discrete second derivative
 * (angular "acceleration") of the angle trace, normalized by the movement's own amplitude and
 * duration so a big slow rep and a small fast rep aren't penalized just for scale. Lower normalized
 * jerk -> higher smoothness. The mapping curve (half-life style falloff) is a deliberate engineering
 * choice, not a clinical constant.
 */
export function smoothness01(samples: AngleSample[]): number {
  if (samples.length < 4) return 1; // too few samples to judge — don't penalize
  const sorted = [...samples].sort((a, b) => a.tMs - b.tMs);
  const amplitude = Math.max(1, Math.max(...sorted.map((s) => s.angleDeg)) - Math.min(...sorted.map((s) => s.angleDeg)));
  const durationSec = Math.max(0.05, (sorted[sorted.length - 1].tMs - sorted[0].tMs) / 1000);

  const accelSamples: number[] = [];
  for (let i = 1; i < sorted.length - 1; i += 1) {
    const dt1 = (sorted[i].tMs - sorted[i - 1].tMs) / 1000;
    const dt2 = (sorted[i + 1].tMs - sorted[i].tMs) / 1000;
    if (dt1 <= 0 || dt2 <= 0) continue;
    const v1 = (sorted[i].angleDeg - sorted[i - 1].angleDeg) / dt1;
    const v2 = (sorted[i + 1].angleDeg - sorted[i].angleDeg) / dt2;
    const dtMid = (dt1 + dt2) / 2;
    accelSamples.push((v2 - v1) / dtMid);
  }
  if (accelSamples.length === 0) return 1;

  const rmsAccel = Math.sqrt(accelSamples.reduce((sum, a) => sum + a * a, 0) / accelSamples.length);
  // Normalize: deg/s^2 relative to amplitude/duration^2 gives a dimensionless "roughness" figure.
  const normalizedJerk = (rmsAccel * durationSec * durationSec) / amplitude;
  // Roughness of ~0 -> smoothness 1; roughness of ~8+ (visibly jerky) -> smoothness near 0.
  return clamp01(1 - normalizedJerk / 8);
}

/** 0..100 — 100 inside [min,max] seconds, linear falloff outside by one range-width. */
export function tempoScore(actualSec: number, [min, max]: [number, number]): number {
  if (actualSec >= min && actualSec <= max) return 100;
  const rangeWidth = Math.max(0.1, max - min);
  const over = actualSec < min ? min - actualSec : actualSec - max;
  return Math.round(clamp01(1 - over / rangeWidth) * 100);
}

/**
 * Controlled-return score: penalizes a rep whose return phase is abrupt relative to its own tempo
 * window (a "dropped" limb) rather than judging absolute speed. A return taking less than a third of
 * the exercise's minimum tempo is flagged as uncontrolled.
 */
export function controlledReturnScore(returnDurationSec: number, tempoRangeSec: [number, number]): number {
  const minControlled = tempoRangeSec[0] / 3;
  if (returnDurationSec >= minControlled) return 100;
  return Math.round(clamp01(returnDurationSec / minControlled) * 100);
}

/** 0..100 — ratio of actual hold duration to target, capped at 100 (no bonus for holding longer). */
export function holdScore(actualHoldSec: number, targetHoldSec: number): number {
  if (targetHoldSec <= 0) return 100;
  return Math.round(Math.min(100, (actualHoldSec / targetHoldSec) * 100));
}

/** Session-level: 100 minus a scaled coefficient-of-variation of peak excursion across valid reps.
 *  Fewer than 2 reps -> can't judge consistency yet, don't penalize. */
export function consistencyScore(peakExcursionsDeg: number[]): number {
  if (peakExcursionsDeg.length < 2) return 100;
  const mean = peakExcursionsDeg.reduce((a, b) => a + b, 0) / peakExcursionsDeg.length;
  if (mean <= 0) return 100;
  const variance = peakExcursionsDeg.reduce((sum, v) => sum + (v - mean) ** 2, 0) / peakExcursionsDeg.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.round(clamp01(1 - cv / 0.5) * 100); // CV of 0.5 (50% spread) -> score 0
}

/** Stability score for hold-type exercises: how little the joint moved during the hold, degrees. */
export function stabilityScore(movementDuringHoldDeg: number, toleranceDeg: number): number {
  if (toleranceDeg <= 0) return movementDuringHoldDeg <= 0 ? 100 : 0;
  return Math.round(clamp01(1 - movementDuringHoldDeg / toleranceDeg) * 100);
}
