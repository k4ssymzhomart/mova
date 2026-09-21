import { describe, expect, it } from "vitest";

import { CORRECTNESS_WEIGHT, TARGET_WEIGHT, VOLUME_WEIGHT, executionEffectiveness } from "./executionScore";
import type { ComponentScore, ExecutionComponentName } from "./types";

/** A component that WAS measured. The sub-component names are irrelevant to the rollup — it reads only
 *  `score` — so one placeholder name keeps these cases readable. */
function measured(score: number): ComponentScore {
  return { score, measured: ["x"], abstained: [], weightUsed: 1 };
}

/** A component with nothing behind it at all. */
const NOT_MEASURED: ComponentScore = { score: null, measured: [], abstained: ["x"], weightUsed: 0 };

describe("executionEffectiveness", () => {
  it("matches the docx §14 Heel Slide worked example (Correctness 88.1, Volume 100, Target 92.5 -> ~91.8)", () => {
    // Session values as stated in docs/PHOENIX_8_Exercises_Targets (1).docx §14.
    const result = executionEffectiveness(measured(88.1), 100, measured(92.5));
    expect(result.score).toBe(92); // 0.5*88.1+0.2*100+0.3*92.5 = 91.8 -> rounds to 92
    expect(result.abstained).toEqual([]);
    expect(result.componentsUsed).toEqual({ correctness: 0.5, volume: 0.2, target: 0.3 });
  });

  it("matches the docx §15 'reps done, target not reached' E_raw (Correctness 90, Volume 100, Target ~25 -> ~72.5)", () => {
    // The doc's own further "target cap" step (72.5 -> 64) is NOT implemented here — see this file's
    // sibling executionScore.ts header for why (no formula given for that second step). Nothing in the
    // returned shape should be read as the cap having been applied: all three weights are the declared
    // ones, untouched.
    const result = executionEffectiveness(measured(90), 100, measured(25));
    expect(result.score).toBe(73); // 0.5*90+0.2*100+0.3*25 = 72.5 -> rounds to 73
    expect(result.componentsUsed).toEqual({ correctness: 0.5, volume: 0.2, target: 0.3 });
  });

  it("never exceeds 100 even with maxed inputs", () => {
    expect(executionEffectiveness(measured(100), 100, measured(100)).score).toBe(100);
  });
});

describe("a component with nothing measured is left out, not counted as a zero", () => {
  it("drops the abstaining component and renormalises the remaining weights", () => {
    const result = executionEffectiveness(NOT_MEASURED, 100, measured(80));
    // (100*0.2 + 80*0.3) / 0.5
    expect(result.score).toBe(88);
    expect(result.componentsUsed).toEqual({ volume: 0.4, target: 0.6 });
    expect(result.abstained).toEqual(["correctness"]);
  });

  it("scores an abstaining component strictly higher than the same component measured at zero", () => {
    // This is the defect, pinned: before the port, an unmeasured Correctness entered the rollup as a
    // number anyway. A patient nobody measured must not be graded like a patient who scored nothing.
    const abstaining = executionEffectiveness(NOT_MEASURED, 100, measured(80));
    const realZero = executionEffectiveness(measured(0), 100, measured(80));
    expect(abstaining.score!).toBeGreaterThan(realZero.score!);
    expect(realZero.abstained).toEqual([]);
  });

  it("abstains on volume when nothing was prescribed", () => {
    const result = executionEffectiveness(measured(90), null, measured(80));
    expect(result.abstained).toEqual(["volume"]);
    // (90*0.5 + 80*0.3) / 0.8 = 86.25 -> 86
    expect(result.score).toBe(86);
  });

  it("returns null, not 0, when no component could be scored at all", () => {
    const result = executionEffectiveness(NOT_MEASURED, null, NOT_MEASURED);
    expect(result.score).toBeNull();
    expect(result.componentsUsed).toEqual({});
    expect(result.abstained).toEqual(["correctness", "volume", "target"]);
  });

  it("reports componentsUsed weights that sum to 1 in every combination that produced a score", () => {
    const options: Array<[ComponentScore, number | null, ComponentScore]> = [];
    for (const cor of [measured(70), NOT_MEASURED]) {
      for (const vol of [90, null]) {
        for (const tgt of [measured(60), NOT_MEASURED]) {
          options.push([cor, vol, tgt]);
        }
      }
    }
    expect(options).toHaveLength(8);

    for (const [cor, vol, tgt] of options) {
      const result = executionEffectiveness(cor, vol, tgt);
      const names = Object.keys(result.componentsUsed) as ExecutionComponentName[];
      if (result.score === null) {
        expect(names).toEqual([]);
        continue;
      }
      const sum = names.reduce((acc, name) => acc + result.componentsUsed[name]!, 0);
      // componentsUsed is rounded to three decimals for display, so the sum is checked to that
      // precision rather than to the float.
      expect(sum, `componentsUsed for ${names.join("+")}`).toBeCloseTo(1, 2);
      // Every name is either used or abstained, never both and never neither.
      expect([...names, ...result.abstained].sort()).toEqual(["correctness", "target", "volume"]);
    }
  });

  it("keeps the spec §2 weights as the declared ones", () => {
    expect(CORRECTNESS_WEIGHT + VOLUME_WEIGHT + TARGET_WEIGHT).toBeCloseTo(1, 9);
  });
});
