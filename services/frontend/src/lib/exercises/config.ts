// What the exercise screen needs to run ONE exercise, resolved from the slug the database gave it.
//
// Three id spaces hold parts of the answer and none can be derived from another (lib/exercises/ids.ts explains why):
// the catalog's kebab-case slug carries the name, the cues and the reference clip; the scoring engine's snake_case
// slug carries the target and the weights; PHOENIX's id carries the signal profile. This module is the one place
// that joins them, so no screen ever has to guess.
//
// It returns null rather than a default for anything it cannot resolve. Four catalog exercises (step-up, calf-raise,
// walking-gait, standing-hip-abduction) deliberately have no scoring config at all, and an exercise with no config
// must be run without a score rather than scored against another exercise's numbers.
//
// NOT node:test-able: it makes runtime imports of the catalog and the scoring configs, which the node:test runner
// cannot resolve through the `@/` alias (see the rule in lib/motion/flexion.ts's header). What it joins is already
// pinned by ids.test.ts, catalog.test.ts and exerciseConfigs.test.ts; what it decides on top of that — the signal —
// is pinned by the table below and its own comment.

import { KNEE_SIGNAL, type FlexionSignal } from "@/lib/motion/flexion";
import { exerciseThresholds, type ResolvedThresholds } from "@/lib/motion/exerciseReps";
import { EXERCISE_CONFIGS } from "@/lib/scoring/exerciseConfigs";
import type { ExerciseConfig, ExerciseSlug } from "@/lib/scoring/types";

import { exerciseBySlug, type ExerciseEntry } from "./catalog";
import { catalogSlug, scoringSlug } from "./ids";

const ANKLE_SIGNAL: FlexionSignal = { kind: "relative", distal: "foot", proximal: "shank" };
const THIGH_SIGNAL: FlexionSignal = { kind: "absolute", role: "thigh" };

/**
 * Exercises whose signal is NOT the one their `primarySensorRoles` implies, taken from PHOENIX's signal profiles in
 * services/imu-tools/src/mova_imu/analysis/exercise_signals.py.
 *
 * `straight_leg_raise` is the case that matters. Its config lists thigh and shank, which reads as a knee-bend
 * differential, but the exercise is a lift of a straight leg: PHOENIX pins `primary=_THIGH` (an absolute thigh pitch)
 * and writes the reason down — "The knee stays straight, so every segment-pair difference stays ~0; the lift only
 * shows up as the thigh's own angle." Its `targetValueDeg: 30` is documented in exerciseConfigs.ts as thigh
 * elevation, not knee flexion, so counting it on a knee differential would compare a target to a signal that does
 * not measure it.
 *
 * The clean fix is to change `primarySensorRoles` to ["thigh"] in exerciseConfigs.ts, which is a clinical change and
 * is raised in the pull request rather than made silently here. Until it lands, this override keeps the RUNNING
 * exercise correct without touching the scoring table.
 */
const SIGNAL_OVERRIDES: Partial<Record<ExerciseSlug, FlexionSignal>> = {
  straight_leg_raise: THIGH_SIGNAL,
};

function isScoredSlug(slug: string): slug is ExerciseSlug {
  return Object.prototype.hasOwnProperty.call(EXERCISE_CONFIGS, slug);
}

/**
 * The orientation signal an exercise is counted on.
 *
 * Derived from the exercise's own `primarySensorRoles` rather than a second hand-kept table, so an exercise added to
 * the scoring configs gets a signal without anyone remembering to add a row here: thigh+shank is a knee bend,
 * shank+foot is an ankle movement, and a single role is that segment's own angle. SIGNAL_OVERRIDES covers the
 * exercises where PHOENIX measured something different and said why.
 */
export function signalFor(config: ExerciseConfig): FlexionSignal {
  const override = SIGNAL_OVERRIDES[config.slug];
  if (override) return override;

  const roles = config.primarySensorRoles;
  if (roles.length === 1) return { kind: "absolute", role: roles[0] };
  if (roles.includes("foot") && roles.includes("shank")) return ANKLE_SIGNAL;
  return KNEE_SIGNAL;
}

/** Everything one exercise needs to be run, scored and described. */
export interface ResolvedExercise {
  /** Canonical kebab-case slug — what the database holds and what every route uses. */
  slug: string;
  /** The library entry: name, cues, common errors, reference clip. Undefined for a slug not in the catalog. */
  entry: ExerciseEntry | undefined;
  /** The scoring config, or null for an exercise the engine has no numbers for. */
  config: ExerciseConfig | null;
  /** How the movement is measured. Null when there is no config to derive it from. */
  signal: FlexionSignal | null;
  /** Entry and exit thresholds for the rep counter, with the rubric applied. */
  thresholds: ResolvedThresholds;
  /** The clinician's reference clip, or null when none has been recorded for this exercise. */
  video: string | null;
  poster: string | null;
}

/**
 * Resolve an exercise by any of its ids, with the clinician's `exercises.scoring_rubric` applied to the thresholds.
 *
 * A slug the catalog does not know still resolves: the screen can then run the exercise without a score and say so,
 * which is better than refusing to open a session a clinician prescribed.
 */
export function resolveExercise(slugOrId: string, rubric?: unknown): ResolvedExercise {
  const slug = catalogSlug(slugOrId) ?? slugOrId;
  const entry = exerciseBySlug(slug);
  const scoring = scoringSlug(slug);
  const config = scoring !== undefined && isScoredSlug(scoring) ? EXERCISE_CONFIGS[scoring] : null;

  return {
    slug,
    entry,
    config,
    signal: config ? signalFor(config) : null,
    thresholds: exerciseThresholds(config?.minValidExcursionDeg ?? null, rubric),
    video: entry?.video ?? null,
    poster: entry?.poster ?? null,
  };
}

/** Whether this exercise can be scored at all. An unscored one is still worth doing; it is just not measured. */
export function isScored(resolved: ResolvedExercise): boolean {
  return resolved.config !== null;
}
