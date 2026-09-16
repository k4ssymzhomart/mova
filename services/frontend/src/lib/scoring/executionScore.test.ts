import { describe, expect, it } from "vitest";

import { executionEffectiveness } from "./executionScore";

describe("executionEffectiveness", () => {
  it("matches the docx §14 Heel Slide worked example (Correctness 88.1, Volume 100, Target 92.5 -> ~91.8)", () => {
    // Session values as stated in docs/PHOENIX_8_Exercises_Targets (1).docx §14.
    expect(executionEffectiveness(88.1, 100, 92.5)).toBe(92); // 0.5*88.1+0.2*100+0.3*92.5 = 91.8 -> rounds to 92
  });

  it("matches the docx §15 'reps done, target not reached' E_raw (Correctness 90, Volume 100, Target ~25 -> ~72.5)", () => {
    // The doc's own further "target cap" step (72.5 -> 64) is NOT implemented here — see this file's
    // sibling executionScore.ts header for why (no formula given for that second step).
    expect(executionEffectiveness(90, 100, 25)).toBe(73); // 0.5*90+0.2*100+0.3*25 = 72.5 -> rounds to 73
  });

  it("never exceeds 100 even with maxed inputs", () => {
    expect(executionEffectiveness(100, 100, 100)).toBe(100);
  });
});
