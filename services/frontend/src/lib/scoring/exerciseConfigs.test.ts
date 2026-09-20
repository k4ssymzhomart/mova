import { describe, expect, it } from "vitest";

import type { SensorRole } from "@/lib/ble/roles";

import { sessionCorrectnessScore } from "./correctnessScore";
import { EXERCISE_CONFIGS, getExerciseConfig } from "./exerciseConfigs";
import type { ExerciseSlug, RepResult } from "./types";

const SLUGS = Object.keys(EXERCISE_CONFIGS) as ExerciseSlug[];
const ROLES: SensorRole[] = ["thigh", "shank", "foot"];

function rep(overrides: Partial<RepResult> = {}): RepResult {
  return {
    index: 1,
    startedAtMs: 0,
    endedAtMs: 4000,
    peakExcursionDeg: 85,
    completed: true,
    validForVolume: true,
    tempoSec: 4,
    smoothness01: 0.8,
    holdSec: 1,
    returnDurationSec: 1.5,
    lossReason: null,
    ...overrides,
  };
}

describe("every exercise config", () => {
  it("is keyed by its own slug", () => {
    for (const slug of SLUGS) {
      expect(getExerciseConfig(slug).slug, `${slug}: key and slug disagree`).toBe(slug);
    }
  });

  it("has correctness weights that sum to 1", () => {
    // The weighted sum in correctnessScore.ts renormalizes over the weights it actually used, so a
    // set that does not sum to 1 would silently change what a full score means.
    for (const slug of SLUGS) {
      const sum = Object.values(getExerciseConfig(slug).correctnessWeights).reduce((a, b) => a + b, 0);
      expect(sum, `${slug}: weights sum to ${sum}`).toBeCloseTo(1, 9);
    }
  });

  it("has no negative or zero weights", () => {
    for (const slug of SLUGS) {
      for (const [key, weight] of Object.entries(getExerciseConfig(slug).correctnessWeights)) {
        expect(weight, `${slug}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("cannot require a bigger minimum excursion than its own target", () => {
    for (const slug of SLUGS) {
      const config = getExerciseConfig(slug);
      // Only "at_least" targets are an excursion to clear. short_arc_quad's 5deg is a residual
      // extension DEFICIT and mini_squat's is the centre of a band, so neither is comparable to a
      // minimum excursion and neither belongs in this check.
      if (config.targetType === "at_least" && config.targetValueDeg !== null) {
        expect(config.minValidExcursionDeg, `${slug}`).toBeLessThanOrEqual(config.targetValueDeg);
      }
    }
  });

  it("names only real sensor roles, without repeats", () => {
    for (const slug of SLUGS) {
      const roles = getExerciseConfig(slug).primarySensorRoles;
      expect(new Set(roles).size, `${slug}: repeated role`).toBe(roles.length);
      for (const role of roles) expect(ROLES, `${slug}: ${role}`).toContain(role);
    }
  });

  it("has a positive tempo window when it has one at all", () => {
    for (const slug of SLUGS) {
      const range = getExerciseConfig(slug).tempoRangeSec;
      if (range === null) continue;
      expect(range[0], `${slug}: tempo min`).toBeGreaterThan(0);
      expect(range[1], `${slug}: tempo max`).toBeGreaterThan(range[0]);
    }
  });

  it("gives a hold target to every exercise that weights a hold on a real target", () => {
    // quad_set's "timing" and heel_slide's "hold" predate this and intentionally fall back to a
    // neutral score; the PHOENIX-profile exercises must not, so their hold weight needs a target.
    for (const slug of ["supported_knee_raise", "seated_knee_extension"] as const) {
      const config = getExerciseConfig(slug);
      expect(config.correctnessWeights.hold, `${slug}: weights a hold`).toBeGreaterThan(0);
      expect(config.holdTargetSec, `${slug}: hold weighted without a target`).toBeGreaterThan(0);
    }
  });
});

describe("an uncalibrated tempo abstains rather than scoring zero", () => {
  it("does not drag the correctness score down", () => {
    const config = getExerciseConfig("ball_knee_flexion");
    expect(config.tempoRangeSec, "this test needs an uncalibrated exercise").toBeNull();

    // A rep whose pace would look terrible against any invented window: 0.2 s per rep.
    const reps = [rep({ tempoSec: 0.2, returnDurationSec: 0.05 })];
    const score = sessionCorrectnessScore(config, reps);

    // smoothness 0.8 -> 80, consistency over a single rep -> 100. Renormalized over the 0.34 + 0.16
    // that were actually used, that is ~86. If tempo and controlled return had scored 0 instead of
    // abstaining, the weighted total would be ~43.
    expect(score).toBeGreaterThan(70);
  });

  it("still scores tempo where a window exists", () => {
    const config = getExerciseConfig("heel_slide");
    expect(config.tempoRangeSec).not.toBeNull();
    const fast = sessionCorrectnessScore(config, [rep({ tempoSec: 0.2, returnDurationSec: 0.05 })]);
    const paced = sessionCorrectnessScore(config, [rep({ tempoSec: 5, returnDurationSec: 1.5 })]);
    expect(paced, "a well-paced rep must beat a rushed one").toBeGreaterThan(fast);
  });

  it("returns a real number even when every component abstains", () => {
    const config = { ...getExerciseConfig("ball_knee_flexion"), correctnessWeights: { tempo: 1 } };
    const score = sessionCorrectnessScore(config, [rep()]);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(0);
  });
});
