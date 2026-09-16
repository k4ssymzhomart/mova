import { describe, expect, it } from "vitest";

import { EXERCISE_CONFIGS } from "./exerciseConfigs";
import { RepDetector } from "./repDetector";
import type { RepResult } from "./types";

const config = EXERCISE_CONFIGS.heel_slide; // target 90deg, min-valid-excursion 22.5deg, tempo [3,8]s

/** A simple triangular rise-then-fall trace from 0 -> peak -> 0, `steps` samples each way. */
function triangleTrace(peakDeg: number, riseMs: number, fallMs: number, stepMs = 50): { tMs: number; angleDeg: number }[] {
  const points: { tMs: number; angleDeg: number }[] = [];
  let t = 0;
  for (; t <= riseMs; t += stepMs) points.push({ tMs: t, angleDeg: (peakDeg * t) / riseMs });
  const riseEnd = t;
  for (let ft = stepMs; ft <= fallMs; ft += stepMs) {
    points.push({ tMs: riseEnd + ft, angleDeg: peakDeg * (1 - ft / fallMs) });
  }
  points.push({ tMs: riseEnd + fallMs, angleDeg: 0 });
  return points;
}

function feed(detector: RepDetector, points: { tMs: number; angleDeg: number }[], signalOk = true): RepResult | null {
  let last: RepResult | null = null;
  for (const p of points) {
    const result = detector.push(p.tMs, p.angleDeg, signalOk);
    if (result) last = result;
  }
  return last;
}

describe("RepDetector", () => {
  it("emits a valid, completed rep for a clean rise-to-peak-and-back trace", () => {
    const detector = new RepDetector({ config });
    const result = feed(detector, triangleTrace(90, 1500, 1500));

    expect(result).not.toBeNull();
    expect(result!.completed).toBe(true);
    expect(result!.validForVolume).toBe(true);
    expect(result!.peakExcursionDeg).toBeCloseTo(90, 0);
    expect(result!.tempoSec).toBeCloseTo(3, 0);
  });

  it("does not count a rep that never clears min_valid_excursion, even though it completes", () => {
    const detector = new RepDetector({ config }); // min_valid_excursion is 22.5deg
    const result = feed(detector, triangleTrace(10, 1000, 1000));

    expect(result).not.toBeNull();
    expect(result!.completed).toBe(true);
    expect(result!.validForVolume).toBe(false);
  });

  it("abandons a rep that never returns to baseline within the timeout — not counted, not a false success", () => {
    const detector = new RepDetector({ config }); // tempoRangeSec[1] = 8s, abandon at 3x = 24s
    const points: { tMs: number; angleDeg: number }[] = [];
    for (let t = 0; t <= 2000; t += 50) points.push({ tMs: t, angleDeg: (90 * t) / 2000 }); // rise to 90deg
    for (let t = 2050; t <= 26_000; t += 500) points.push({ tMs: t, angleDeg: 90 }); // ...and just stay there

    const result = feed(detector, points);
    expect(result).not.toBeNull();
    expect(result!.completed).toBe(false);
    expect(result!.validForVolume).toBe(false);
  });

  it("excludes a rep from Volume when signal quality was bad for most of it — never blames the patient", () => {
    const detector = new RepDetector({ config });
    const trace = triangleTrace(90, 1500, 1500);
    let last: RepResult | null = null;
    for (const [i, p] of trace.entries()) {
      // Signal is bad for the first 60% of samples — over the 50% threshold.
      const signalOk = i > trace.length * 0.6;
      const result = detector.push(p.tMs, p.angleDeg, signalOk);
      if (result) last = result;
    }
    expect(last).not.toBeNull();
    expect(last!.lossReason).toBe("sensor");
    expect(last!.validForVolume).toBe(false);
  });

  it("counts consecutive reps with independent indices", () => {
    const detector = new RepDetector({ config });
    const first = feed(detector, triangleTrace(90, 1500, 1500));
    const secondTrace = triangleTrace(90, 1500, 1500).map((p) => ({ tMs: p.tMs + 4000, angleDeg: p.angleDeg }));
    const second = feed(detector, secondTrace);

    expect(first!.index).toBe(0);
    expect(second!.index).toBe(1);
  });
});
