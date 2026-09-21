// Pins the one behaviour correctnessScore.ts exists to guarantee: a technique component nobody measured
// is reported as unmeasured. Before this file existed, four separate paths in that module handed back a
// free 100 (a hold with no target, a return with no duration, a Short Arc Quad with no calibration
// angles, and any unrecognised config key), while the all-abstained case returned 0 in one function and
// 100 in its neighbour. Every test below fails if any of those numbers comes back.
//
// Vitest, per vitest.config.ts's include list — sibling imports carry no file extension here, unlike the
// node:test suites under src/lib/motion.

import { describe, expect, it } from "vitest";

import {
  KNOWN_COMPONENT_KEYS,
  isKnownComponentKey,
  perRepCorrectnessScore,
  sessionCorrectnessScore,
} from "./correctnessScore";
import { EXERCISE_CONFIGS, getExerciseConfig } from "./exerciseConfigs";
import type { ExerciseSlug, RepResult } from "./types";

function rep(overrides: Partial<RepResult> = {}): RepResult {
  return {
    index: 0,
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

describe("sessionCorrectnessScore — what abstains is named, not absorbed", () => {
  it("names an uncalibrated tempo in `abstained` instead of silently absorbing its weight", () => {
    // ball_knee_flexion has tempoRangeSec: null, which makes both tempo (0.28) and controlledReturn
    // (0.22) abstain — half of its declared weight. Two reps so the consistency term has something to
    // compare and does not abstain as well.
    const config = getExerciseConfig("ball_knee_flexion");
    expect(config.tempoRangeSec, "this test needs an uncalibrated exercise").toBeNull();

    const score = sessionCorrectnessScore(config, [rep(), rep({ index: 1 })]);

    expect(score.abstained).toEqual(["tempo", "controlledReturn"]);
    expect(score.measured).toEqual(["smoothness", "consistency"]);
    expect(score.weightUsed).toBeCloseTo(0.5, 9);
    // The number is still reported — the point is that it comes with the record of what produced it.
    expect(score.score).not.toBeNull();
  });

  it("abstains on consistency when there is only one rep to compare", () => {
    // kinematics.ts's consistencyScore returns 100 for a single rep ("can't judge consistency yet").
    // A component that cannot be judged is not a component that scored perfectly.
    const config = getExerciseConfig("ball_knee_flexion");
    const single = sessionCorrectnessScore(config, [rep()]);
    expect(single.abstained).toContain("consistency");
    expect(single.measured).toEqual(["smoothness"]);
  });

  it("abstains on a hold that is weighted without a hold target, rather than scoring it a free 100", () => {
    // heel_slide weights hold at 0.10 and has no holdTargetSec. PHOENIX has a calibrated 1.1 s target
    // for this exercise (execution_score.py:65) that mova has not adopted, so the honest report is that
    // the hold was not scored — not that it was scored perfectly.
    const config = getExerciseConfig("heel_slide");
    expect(config.holdTargetSec, "this test needs an exercise that weights a hold with no target").toBeUndefined();
    expect(config.correctnessWeights.hold).toBeGreaterThan(0);

    const noHold = sessionCorrectnessScore(config, [rep({ holdSec: 0 }), rep({ index: 1, holdSec: 0 })]);
    expect(noHold.abstained).toContain("hold");
    expect(noHold.measured).not.toContain("hold");
    expect(noHold.weightUsed).toBeCloseTo(1 - config.correctnessWeights.hold, 9);

    // And the free 100 is really gone: reconstructing the old behaviour by hand gives a HIGHER number
    // than the honest renormalised one, because the 0.10 used to arrive pre-filled with a perfect score.
    const oldFreeHundred = Math.round(noHold.score! * noHold.weightUsed + 100 * config.correctnessWeights.hold);
    expect(oldFreeHundred).toBeGreaterThan(noHold.score!);
  });

  it("abstains on a return phase the detector never recorded", () => {
    const config = getExerciseConfig("heel_slide");
    const score = sessionCorrectnessScore(config, [
      rep({ returnDurationSec: undefined }),
      rep({ index: 1, returnDurationSec: undefined }),
    ]);
    expect(score.abstained).toContain("controlledReturn");
  });

  it("abstains on Short Arc Quad's extension control when the calibration angles were never supplied", () => {
    // repDetector only fills startAngleDeg/finalAngleDeg when useLiveScoring was constructed with its
    // optional calibrationBaselineAbsoluteDeg. Without it this component used to gift 0.25 of the score.
    const config = getExerciseConfig("short_arc_quad");
    const score = sessionCorrectnessScore(config, [rep(), rep({ index: 1 })]);
    expect(score.abstained).toContain("extensionControl");
  });

  it("abstains on a Straight Leg Raise knee-stability reading that is simply absent", () => {
    const config = getExerciseConfig("straight_leg_raise");
    const score = sessionCorrectnessScore(config, [
      rep({ peakExcursionDeg: 30, secondaryMetricDeg: undefined }),
      rep({ index: 1, peakExcursionDeg: 30, secondaryMetricDeg: undefined }),
    ]);
    expect(score.abstained).toContain("kneeStability");
  });

  it("abstains on an unknown component key rather than scoring it 100", () => {
    const config = { ...getExerciseConfig("heel_slide"), correctnessWeights: { smoothness: 0.5, nonsense: 0.5 } };
    const score = sessionCorrectnessScore(config, [rep(), rep({ index: 1 })]);
    expect(score.abstained).toContain("nonsense");
    expect(score.measured).toEqual(["smoothness"]);
    // smoothness 0.8 -> 80, renormalised over the 0.5 that was actually used.
    expect(score.score).toBe(80);
  });

  it("reports nothing measured, not a zero, when every component abstains", () => {
    const config = { ...getExerciseConfig("ball_knee_flexion"), correctnessWeights: { tempo: 1 } };
    const score = sessionCorrectnessScore(config, [rep()]);
    expect(score.score).toBeNull();
    expect(score.weightUsed).toBe(0);
    expect(score.abstained).toEqual(["tempo"]);
    expect(score.measured).toEqual([]);
  });

  it("reports nothing measured when there were no valid reps at all", () => {
    const config = getExerciseConfig("heel_slide");
    const score = sessionCorrectnessScore(config, [rep({ validForVolume: false, lossReason: "sensor" })]);
    expect(score.score).toBeNull();
    expect(score.weightUsed).toBe(0);
    expect(score.abstained).toEqual(Object.keys(config.correctnessWeights));
  });
});

describe("neither per-rep nor session correctness invents a number when nothing is calibrated", () => {
  // The regression this names: sessionCorrectnessScore used to return 0 here and perRepCorrectnessScore
  // used to return 100, seventeen lines apart in the same file, for the identical situation.
  it("both report null for a config whose only non-consistency component abstains", () => {
    const config = {
      ...getExerciseConfig("ball_knee_flexion"),
      correctnessWeights: { tempo: 0.6, consistency: 0.4 },
    };
    const single = rep();

    expect(sessionCorrectnessScore(config, [single]).score).toBeNull();
    expect(perRepCorrectnessScore(config, single).score).toBeNull();
  });

  it("perRepCorrectnessScore skips consistency instead of listing it as an abstention", () => {
    // Consistency compares reps to each other, so it is not something one rep could have reported and
    // naming it as "not measured" for a single rep would be misleading rather than honest.
    const config = getExerciseConfig("heel_slide");
    const score = perRepCorrectnessScore(config, rep());
    expect(score.abstained).not.toContain("consistency");
    expect(score.measured).not.toContain("consistency");
  });
});

describe("the component whitelist", () => {
  it("recognises every component key in every shipped config", () => {
    // A key componentScore does not recognise now abstains rather than scoring 100, which means a typo
    // in a config would go quiet instead of loud. This test is what makes it loud again.
    for (const slug of Object.keys(EXERCISE_CONFIGS) as ExerciseSlug[]) {
      for (const key of Object.keys(EXERCISE_CONFIGS[slug].correctnessWeights)) {
        expect(isKnownComponentKey(key), `${slug}.${key} is not a component componentScore can score`).toBe(true);
      }
    }
  });

  it("lists no duplicates", () => {
    expect(new Set(KNOWN_COMPONENT_KEYS).size).toBe(KNOWN_COMPONENT_KEYS.length);
  });
});
