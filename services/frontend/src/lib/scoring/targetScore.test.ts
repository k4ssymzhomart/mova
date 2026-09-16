import { describe, expect, it } from "vitest";

import { EXERCISE_CONFIGS } from "./exerciseConfigs";
import { perRepTargetScore } from "./targetScore";
import type { RepResult } from "./types";

function rep(overrides: Partial<RepResult> = {}): RepResult {
  return {
    index: 0,
    startedAtMs: 0,
    endedAtMs: 1000,
    peakExcursionDeg: 0,
    completed: true,
    validForVolume: true,
    tempoSec: 3,
    smoothness01: 1,
    holdSec: 0,
    lossReason: null,
    ...overrides,
  };
}

describe("perRepTargetScore — heel_slide (docx §14 per-rep table)", () => {
  const config = EXERCISE_CONFIGS.heel_slide;

  it("82deg peak against a 90deg target -> 91 (docx table says 70, but that table's per-rep numbers are illustrative narrative, not derived from the at-least ratio formula — see note below)", () => {
    // The docx's §14 per-rep "Target score" column (70, 70, 85, 100...) does not match a plain
    // min(100, peak/target*100) ratio for every row (e.g. 82/90*100 ~ 91, not 70) — it reads as scoring
    // banded/rounded presentation rather than the raw ratio. §2's canonical formula IS the raw ratio, so
    // that's what this implements; this test documents the actual formula's output, not a replay of the
    // table's specific numbers.
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 82 }))).toBe(91);
  });

  it("90deg peak against a 90deg target -> exactly 100, no bonus", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 90 }))).toBe(100);
  });

  it("95deg peak (past target) still caps at 100 — spec §9.2, no bonus for exceeding", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 95 }))).toBe(100);
  });

  it("a rep that isn't valid for volume scores 0, not a fabricated partial number", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 90, validForVolume: false }))).toBe(0);
  });
});

describe("perRepTargetScore — mini_squat band table (docx §11)", () => {
  const config = EXERCISE_CONFIGS.mini_squat;

  it("30deg (center of 25-35 band) -> 100", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 30 }))).toBe(100);
  });

  it("22deg (20-24 band) -> 80", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 22 }))).toBe(80);
  });

  it("38deg (36-40 band, symmetric on the other side) -> 80", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 38 }))).toBe(80);
  });

  it("50deg (past the last band) does not increase further -> stays at 60", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 50 }))).toBe(60);
  });

  it("5deg (below the lowest band) -> 0", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 5 }))).toBe(0);
  });
});

describe("perRepTargetScore — short_arc_quad deficit formula (docx §4)", () => {
  const config = EXERCISE_CONFIGS.short_arc_quad;

  it("start 30deg, final 5deg (full extension) -> 100", () => {
    expect(perRepTargetScore(config, rep({ startAngleDeg: 30, finalAngleDeg: 5 }))).toBe(100);
  });

  it("start 30deg, final <5deg -> still 100, per the spec's explicit <=5deg clause", () => {
    expect(perRepTargetScore(config, rep({ startAngleDeg: 30, finalAngleDeg: 2 }))).toBe(100);
  });

  it("start 30deg, final 17.5deg (halfway to target excursion) -> 50", () => {
    expect(perRepTargetScore(config, rep({ startAngleDeg: 30, finalAngleDeg: 17.5 }))).toBe(50);
  });
});

describe("perRepTargetScore — straight_leg_raise 70/30 split (docx §4)", () => {
  const config = EXERCISE_CONFIGS.straight_leg_raise;

  it("full elevation (30deg) with knee lag within the 10deg target -> 100", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 30, secondaryMetricDeg: 5 }))).toBe(100);
  });

  it("full elevation but poor knee control (30deg lag, the falloff floor) -> only the elevation 70% counts", () => {
    expect(perRepTargetScore(config, rep({ peakExcursionDeg: 30, secondaryMetricDeg: 30 }))).toBe(70);
  });
});

describe("perRepTargetScore — quad_set 70/30 hold+stability split (docx §4)", () => {
  const config = EXERCISE_CONFIGS.quad_set;

  it("full 5s hold with a stable knee (0deg movement) -> 100", () => {
    expect(perRepTargetScore(config, rep({ holdSec: 5, peakExcursionDeg: 0 }))).toBe(100);
  });

  it("half the hold duration, perfectly stable -> 70% subscore at 50% -> 35 + 30 = 65", () => {
    expect(perRepTargetScore(config, rep({ holdSec: 2.5, peakExcursionDeg: 0 }))).toBe(65);
  });
});
