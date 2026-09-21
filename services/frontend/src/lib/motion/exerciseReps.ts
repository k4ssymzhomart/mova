// Repetition thresholds for any exercise, not just Heel Slide.
//
// `reps.heelSlideThresholds` floors the entry threshold at ENTER_DEG (18°) because a draft Heel Slide rubric with a
// small number must not let jitter count as reps. That floor is correct for a 90° knee bend and wrong for everything
// else: PHOENIX's own signal profiles enter an ankle pump at 4° and a lying partial leg raise at 8°
// (services/imu-tools/src/mova_imu/analysis/exercise_signals.py), both well under 18. Applying Heel Slide's floor to
// them would count no repetitions at all, silently, and the screen would show a patient a zero they earned honestly.
//
// So the floor here comes from the exercise itself — its own `minValidExcursionDeg` — and the clinician's rubric may
// only raise it, never lower it below what the exercise declares. That keeps the original protection (a rubric cannot
// make jitter count) without imposing one exercise's scale on another.
//
// The degrees are the uncalibrated orientation proxy's, not knee degrees. reps.ts says this about its own thresholds
// and it is just as true here: whether a given slide clears the entry threshold depends on how the sensors sit on the
// leg. Making the two the same unit is calibration's job (#17), not this module's.
//
// Pure, with type-only imports, so `npm run test:unit` can run this source directly — see the rule in flexion.ts's
// header. No runtime imports of siblings.

import type { RepThresholds } from "./reps";

/** Where an exercise's entry threshold came from, so a screen or a summary can say rather than imply. */
export type ThresholdSource = "rubric" | "exercise" | "fallback";

export interface ResolvedThresholds extends RepThresholds {
  source: ThresholdSource;
}

/**
 * The exit threshold as a fraction of the entry threshold. PHOENIX sets exit to roughly 30–50% of enter across its
 * profiles (heel slide 7/22.5, ankle pump 2/4, leg raise 4/8, seated extension 7/20); 40% sits inside that band for
 * every one of them. It is an engineering default and not a clinical constant — an exercise that states its own exit
 * threshold should pass one rather than rely on this.
 */
const EXIT_FRACTION = 0.4;

/** A rep shorter than this is a twitch, not a repetition. Same value reps.ts uses for Heel Slide. */
const MIN_REP_MS = 250;

/** Used only when an exercise declares no minimum excursion at all, so something still has to be chosen. */
const FALLBACK_ENTER_DEG = 18;

/** `min_valid_excursion_deg` from an `exercises.scoring_rubric`, when it holds a usable positive number. */
export function rubricExcursionDeg(rubric: unknown): number | null {
  if (rubric === null || typeof rubric !== "object") return null;
  const declared = (rubric as Record<string, unknown>).min_valid_excursion_deg;
  return typeof declared === "number" && Number.isFinite(declared) && declared > 0 ? declared : null;
}

/**
 * Thresholds for one exercise.
 *
 * @param minValidExcursionDeg the exercise's own smallest counting excursion (ExerciseConfig.minValidExcursionDeg),
 *   or null when it declares none.
 * @param rubric the `exercises.scoring_rubric` as stored, if any. It may raise the entry threshold and is ignored
 *   when it would lower it below what the exercise declares.
 * @param exitDegOverride an exercise's own exit threshold when one is known, in place of the EXIT_FRACTION default.
 */
export function exerciseThresholds(
  minValidExcursionDeg: number | null | undefined,
  rubric?: unknown,
  exitDegOverride?: number | null,
): ResolvedThresholds {
  const declared =
    typeof minValidExcursionDeg === "number" && Number.isFinite(minValidExcursionDeg) && minValidExcursionDeg > 0
      ? minValidExcursionDeg
      : null;
  const fromRubric = rubricExcursionDeg(rubric);

  let enterDeg: number;
  let source: ThresholdSource;
  if (declared === null && fromRubric === null) {
    enterDeg = FALLBACK_ENTER_DEG;
    source = "fallback";
  } else if (fromRubric !== null && fromRubric > (declared ?? 0)) {
    enterDeg = fromRubric;
    source = "rubric";
  } else {
    enterDeg = declared ?? FALLBACK_ENTER_DEG;
    source = declared === null ? "fallback" : "exercise";
  }

  const exitDeg =
    typeof exitDegOverride === "number" && Number.isFinite(exitDegOverride) && exitDegOverride > 0
      ? Math.min(exitDegOverride, enterDeg * 0.9)
      : enterDeg * EXIT_FRACTION;

  return { enterDeg, exitDeg, minRepMs: MIN_REP_MS, source };
}
