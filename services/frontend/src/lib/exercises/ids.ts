// Exercise identity across mova's own layers and the PHOENIX analysis tooling.
//
// Three id spaces exist for the same exercises and none of them can be derived from another:
//
//   catalog   kebab-case   catalog.ts and the public.exercises table. CANONICAL: it is what the
//                          hosted database holds and what every runtime path in the app resolves.
//   scoring   snake_case   the ExerciseSlug union in lib/scoring/types.ts. null when the exercise
//                          has no scoring config.
//   phoenix   exercise-…-v1  the SIGNAL_PROFILES key the vendored analysis in services/imu-tools is
//                          keyed on. null when PHOENIX has no signal profile for it.
//
// Nothing here derives one from another by string transformation. Guessing is exactly how this repo
// ended up with `heel-slide` in production and `heel_slide` in the scoring engine and in the
// unapplied migration 0038 — whose own header warns it would create a second Heel Slide row. A
// lookup with no row returns undefined and the caller has to deal with it.
//
// This table maps IDENTITY ONLY — never a threshold, a target or a sensor list. mova's `ankle-pumps`
// and PHOENIX's `exercise-ankle-pumps-active-v1` are the same exercise measured with different
// conventions (8° per full cycle here, 4° for one direction there), and reconciling those is a
// clinical decision, not a lookup.
//
// The same table lives in services/imu-tools/exercise_ids.json, which is the source of truth;
// ids.test.ts reads that file and fails if the two drift apart.

export interface ExerciseIds {
  /** Canonical kebab-case slug: catalog.ts and public.exercises. */
  readonly catalog: string;
  /** snake_case ExerciseSlug, or null when the exercise has no scoring config. */
  readonly scoring: string | null;
  /** PHOENIX SIGNAL_PROFILES key, or null when it has no signal profile. */
  readonly phoenix: string | null;
}

export const EXERCISE_IDS: readonly ExerciseIds[] = [
  { catalog: "heel-slide", scoring: "heel_slide", phoenix: "exercise-heel-slide-v1" },
  { catalog: "straight-leg-raise", scoring: "straight_leg_raise", phoenix: "exercise-straight-leg-raise-v1" },
  { catalog: "ankle-pumps", scoring: "ankle_pumps", phoenix: "exercise-ankle-pumps-active-v1" },
  { catalog: "step-up", scoring: null, phoenix: "exercise-step-up-v1" },
  { catalog: "seated-knee-extension", scoring: "seated_knee_extension", phoenix: "exercise-seated-knee-extension-v1" },
  { catalog: "ball-knee-flexion", scoring: "ball_knee_flexion", phoenix: "exercise-ball-knee-flexion-v1" },
  { catalog: "heel-slide-with-band", scoring: "heel_slide_with_band", phoenix: "exercise-heel-slide-with-band-v1" },
  { catalog: "supported-knee-raise", scoring: "supported_knee_raise", phoenix: "exercise-supported-knee-raise-v1" },
  { catalog: "resisted-ankle-pump", scoring: "resisted_ankle_pump", phoenix: "exercise-resisted-ankle-pump-v1" },
  { catalog: "lying-partial-leg-raise", scoring: "lying_partial_leg_raise", phoenix: "exercise-lying-partial-leg-raise-v1" },
  { catalog: "lying-partial-leg-hold", scoring: "lying_partial_leg_hold", phoenix: "exercise-lying-partial-leg-hold-v1" },

  { catalog: "seated-knee-flexion", scoring: "seated_knee_flexion", phoenix: null },
  { catalog: "prone-knee-bend", scoring: "prone_knee_bend", phoenix: null },
  { catalog: "short-arc-quad", scoring: "short_arc_quad", phoenix: null },
  { catalog: "mini-squat", scoring: "mini_squat", phoenix: null },
  { catalog: "quad-set", scoring: "quad_set", phoenix: null },
  { catalog: "calf-raise", scoring: null, phoenix: null },
  { catalog: "walking-gait", scoring: null, phoenix: null },
  { catalog: "standing-hip-abduction", scoring: null, phoenix: null },
];

/**
 * PHOENIX signal profiles deliberately without a mova exercise. Listed so a profile added upstream
 * and forgotten here fails a test rather than silently having no exercise.
 *
 * Empty right now: every PHOENIX profile has a catalog entry. The two thigh-absolute raises that used
 * to sit here were mapped in September 2026. mova still has no clinician-recorded clip of either, and
 * that stays recorded where it belongs — as `video: null` on their catalog.ts entries — rather than as
 * a missing identity mapping, which is a different fact about a different thing.
 */
export const PHOENIX_UNMAPPED: readonly string[] = [];

/** Look an exercise up by an id in any of the three spaces. `undefined` when there is no row. */
export function resolveExerciseIds(value: string): ExerciseIds | undefined {
  return EXERCISE_IDS.find(
    (row) => row.catalog === value || row.phoenix === value || row.scoring === value,
  );
}

/** The canonical kebab-case slug for any known id. */
export function catalogSlug(value: string): string | undefined {
  return resolveExerciseIds(value)?.catalog;
}

/** The snake_case ExerciseSlug, or undefined when the exercise has no scoring config. */
export function scoringSlug(value: string): string | undefined {
  return resolveExerciseIds(value)?.scoring ?? undefined;
}

/** The PHOENIX SIGNAL_PROFILES key, or undefined when it has no signal profile. */
export function phoenixId(value: string): string | undefined {
  return resolveExerciseIds(value)?.phoenix ?? undefined;
}
