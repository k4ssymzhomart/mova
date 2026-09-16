import { describe, expect, it } from "vitest";

import { volumeScore } from "./volumeScore";
import type { RepResult } from "./types";

function rep(overrides: Partial<RepResult> = {}): RepResult {
  return {
    index: 0,
    startedAtMs: 0,
    endedAtMs: 1000,
    peakExcursionDeg: 90,
    completed: true,
    validForVolume: true,
    tempoSec: 3,
    smoothness01: 1,
    holdSec: 0,
    lossReason: null,
    ...overrides,
  };
}

describe("volumeScore", () => {
  it("matches the docx §7 table: 10/10 valid -> 100", () => {
    expect(volumeScore(Array.from({ length: 10 }, () => rep()), 10)).toBe(100);
  });

  it("matches the docx §7 table: 8/10 valid -> 80", () => {
    expect(volumeScore(Array.from({ length: 8 }, () => rep()), 10)).toBe(80);
  });

  it("matches the docx §7 table: 5/10 valid -> 50", () => {
    expect(volumeScore(Array.from({ length: 5 }, () => rep()), 10)).toBe(50);
  });

  it("caps at 100 for 12 valid reps against a 10-rep prescription — no bonus for exceeding", () => {
    expect(volumeScore(Array.from({ length: 12 }, () => rep()), 10)).toBe(100);
  });

  it("does not count reps lost to a sensor problem", () => {
    const reps = [
      ...Array.from({ length: 4 }, () => rep()),
      rep({ validForVolume: false, lossReason: "sensor" }),
    ];
    expect(volumeScore(reps, 10)).toBe(40);
  });
});
