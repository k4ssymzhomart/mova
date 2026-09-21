// Which joint the camera watches for a given exercise.
//
// WHY THIS FILE EXISTS. Nothing in the repo declares a primary JOINT. The catalog (catalog.ts) has no
// joint and no body-position field, and the scoring configs come closest with `primarySensorRoles`,
// which names sensor mounting points rather than an articulation. The camera needs a joint, so the map
// is derived once, here, and read from the session screen.
//
// WHERE THE ROWS COME FROM. Each row is read off ExerciseConfig.primarySensorRoles in
// src/lib/scoring/exerciseConfigs.ts by one rule: ["thigh","shank"] brackets the KNEE, ["shank","foot"]
// brackets the ANKLE. The three exceptions are marked below and are not derived from the sensor pair at
// all — they are what the exercise's own target says it measures.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not guess. An exercise with no row returns null and the
// screen then draws the skeleton with no angle readout, which is the honest outcome for an exercise
// whose primary joint no source states. Four catalog entries are deliberately absent for that reason:
// calf-raise, step-up, walking-gait and standing-hip-abduction have no scoring config, so there is no
// primarySensorRoles to read and nothing else states what to measure. It also holds no target, no
// threshold and no tolerance — those belong to the scoring configs, and a camera angle is not
// comparable with them anyway (see the honesty note in lib/cv/jointAngles.ts).
//
// This module runs a lookup from ids.ts at runtime, so it is not one of the modules node --test
// executes directly; it has no test file of its own for that reason. The map itself is covered by
// whichever screen reads it, and a wrong row shows up immediately as the wrong joint on screen.

import type { JointAngleKind } from "@/lib/cv/jointAngles";
import { catalogSlug } from "@/lib/exercises/ids";

/**
 * Keyed on the canonical kebab-case catalog slug. Values are the three kinds lib/cv/jointAngles
 * measures. Exported so a test or a clinician-facing page can show the whole table.
 */
export const VISION_JOINT: Readonly<Record<string, JointAngleKind>> = {
  // thigh + shank — the knee sits between the two sensors.
  "heel-slide": "knee",
  "heel-slide-with-band": "knee",
  "seated-knee-flexion": "knee",
  "seated-knee-extension": "knee",
  "prone-knee-bend": "knee",
  "short-arc-quad": "knee",
  "ball-knee-flexion": "knee",
  "supported-knee-raise": "knee",
  "mini-squat": "knee",
  "quad-set": "knee",

  // shank + foot — the ankle sits between the two sensors.
  "ankle-pumps": "ankle",
  "resisted-ankle-pump": "ankle",

  // The exceptions. These three are thigh-absolute raises: the leg stays straight on purpose and the
  // movement to watch is how far the thigh lifts, not how far the knee bends. exerciseConfigs.ts:70
  // records straight_leg_raise's targetValueDeg 30 as "thigh elevation" in as many words; the two
  // lying-partial exercises are the same movement held or repeated, and PHOENIX_UNMAPPED in ids.ts
  // calls them "thigh-absolute raises". Watching the knee here would score a patient on holding their
  // leg straight, which is the one thing the exercise asks them not to change.
  "straight-leg-raise": "thigh",
  "lying-partial-leg-raise": "thigh",
  "lying-partial-leg-hold": "thigh",
};

/**
 * The joint to watch for an exercise, or null when no source states one. Accepts an id in any of the
 * three spaces ids.ts knows (catalog, scoring, PHOENIX) and normalises it first, because a session row
 * may hold either spelling. An unknown id returns null; nothing here throws.
 *
 * The two lying-partial slugs are in the map before they are in the catalog: they are being added in
 * the same round, and a row for a slug that does not exist yet is inert, whereas a missing row would
 * silently drop the readout on the day the catalog lands.
 */
export function visionJointFor(exerciseId: string | null | undefined): JointAngleKind | null {
  if (!exerciseId) return null;
  const slug = catalogSlug(exerciseId) ?? exerciseId;
  return VISION_JOINT[slug] ?? null;
}
