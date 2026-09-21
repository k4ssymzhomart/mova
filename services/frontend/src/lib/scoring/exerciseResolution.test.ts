// Every exercise in the catalog must resolve to something the session screen can actually run.
//
// This is the test that would have caught the two defects the generic runner shipped with: an exercise whose
// scoring config exists but whose signal is null (so nothing is ever measured and the repetition counter cannot
// move), and an exercise whose target is stated against a different joint from the one its sensors measure.
//
// It lives under src/lib/scoring/ rather than next to lib/exercises/config.ts because that is the tree vitest
// runs; everything under src/lib/exercises/ is a node:test file, and node:test cannot resolve the `@/` alias that
// config.ts needs at runtime (see the rule in lib/motion/flexion.ts's header).

import { describe, expect, it } from "vitest";

import { EXERCISE_CATALOG } from "@/lib/exercises/catalog";
import { resolveExercise, signalFor } from "@/lib/exercises/config";
import { EXERCISE_IDS } from "@/lib/exercises/ids";
import { visionJointFor } from "@/lib/exercises/visionJoint";
import { STATIC_ENTER_DEG } from "@/lib/motion/exerciseReps";
import { signalRoles } from "@/lib/motion/flexion";

import { EXERCISE_CONFIGS } from "./exerciseConfigs";

const SCORED = EXERCISE_IDS.filter((row) => row.scoring !== null).map((row) => row.catalog);
const UNSCORED = EXERCISE_IDS.filter((row) => row.scoring === null).map((row) => row.catalog);

describe("every catalog exercise resolves to something runnable", () => {
  it("covers the whole catalog, so a new exercise cannot be added without appearing here", () => {
    const catalog = EXERCISE_CATALOG.map((entry) => entry.slug).sort();
    expect([...SCORED, ...UNSCORED].sort()).toEqual(catalog);
  });

  it.each(EXERCISE_CATALOG.map((entry) => entry.slug))("%s resolves", (slug) => {
    const resolved = resolveExercise(slug);
    expect(resolved.slug).toBe(slug);
    expect(resolved.entry).toBeDefined();

    // The counting threshold must be a real, positive number whichever path produced it. Heel Slide's 18-degree
    // floor once applied to every exercise, which counted no ankle pumps at all.
    expect(resolved.thresholds.enterDeg).toBeGreaterThan(0);
    expect(resolved.thresholds.exitDeg).toBeGreaterThan(0);
    expect(resolved.thresholds.exitDeg).toBeLessThan(resolved.thresholds.enterDeg);
  });
});

describe("a scored exercise has everything the engine needs", () => {
  it.each(SCORED)("%s", (slug) => {
    const { config, signal } = resolveExercise(slug);
    expect(config).not.toBeNull();
    // A config with no signal means nothing is ever measured: the counter cannot move and the score is empty.
    expect(signal).not.toBeNull();
    expect(signalRoles(signal!).length).toBeGreaterThan(0);

    // The exercise's own minimum excursion is what gates a repetition, so it has to reach the counter — except
    // for a static hold, which declares zero because the joint is meant not to move (see STATIC_ENTER_DEG).
    const { thresholds } = resolveExercise(slug);
    if (config!.minValidExcursionDeg === 0) {
      expect(thresholds.source).toBe("static");
      expect(thresholds.enterDeg).toBe(STATIC_ENTER_DEG);
    } else {
      expect(thresholds.source).toBe("exercise");
      expect(thresholds.enterDeg).toBe(config!.minValidExcursionDeg);
    }
  });

  it("measures an elevation target on the thigh, never on a knee differential", () => {
    // straight_leg_raise's config still lists thigh+shank (a knee-bend differential) against a target documented
    // as thigh ELEVATION; lib/exercises/config.ts overrides its signal for exactly that reason. The two lying
    // partial raises state the same target and declare ["thigh"] outright. If any of the three ever ends up
    // measuring a knee angle, its target is being compared against a signal that does not measure it.
    for (const slug of ["straight-leg-raise", "lying-partial-leg-raise", "lying-partial-leg-hold"]) {
      const { signal } = resolveExercise(slug);
      expect(signal, slug).toEqual({ kind: "absolute", role: "thigh" });
      expect(visionJointFor(slug), slug).toBe("thigh");
    }
  });

  it("measures an ankle exercise at the ankle", () => {
    for (const slug of ["ankle-pumps", "resisted-ankle-pump"]) {
      const { signal } = resolveExercise(slug);
      expect(signal, slug).toEqual({ kind: "relative", distal: "foot", proximal: "shank" });
      expect(visionJointFor(slug), slug).toBe("ankle");
    }
  });

  it("derives the signal from the config's own sensors, so a new config needs no second table", () => {
    for (const config of Object.values(EXERCISE_CONFIGS)) {
      const roles = signalRoles(signalFor(config));
      for (const role of roles) expect(["thigh", "shank", "foot"]).toContain(role);
    }
  });
});

describe("an unscored exercise degrades honestly rather than failing", () => {
  it.each(UNSCORED)("%s runs without a score", (slug) => {
    const { config, signal, thresholds } = resolveExercise(slug);
    // No config is the honest state for these four: no source states a target for them.
    expect(config).toBeNull();
    expect(signal).toBeNull();
    // It must still be countable, or the screen shows a repetition counter that can never move.
    expect(thresholds.enterDeg).toBeGreaterThan(0);
    expect(thresholds.source).toBe("fallback");
  });
});

describe("the clinician's rubric can raise a threshold but never lower it", () => {
  it("raises", () => {
    const raised = resolveExercise("ankle-pumps", { min_valid_excursion_deg: 20 });
    expect(raised.thresholds.enterDeg).toBe(20);
    expect(raised.thresholds.source).toBe("rubric");
  });

  it("does not lower", () => {
    const lowered = resolveExercise("heel-slide", { min_valid_excursion_deg: 2 });
    expect(lowered.thresholds.enterDeg).toBe(22.5);
    expect(lowered.thresholds.source).toBe("exercise");
  });
});
