// Decisions the Heel Slide exercise screen makes from the session's status and the sensors' links. Pure, so the
// node tests pin them; the screen (HeelSlideExercise) only wires them to React and the router.

import type { SensorRole } from "@/lib/ble/roles";
import type { SensorLink } from "@/lib/sensors/types";

/**
 * The proxy is shank pitch minus thigh pitch, so only these two sensors can pause counting. The foot sensor is
 * recorded but takes no part in the count.
 */
export const COUNTING_ROLES = ["thigh", "shank"] as const;
export type CountingRole = (typeof COUNTING_ROLES)[number];

/** The counting sensors that are not streaming right now, thigh first. */
export function missingCountingRoles(roles: Record<SensorRole, { link: SensorLink }>): CountingRole[] {
  return COUNTING_ROLES.filter((role) => roles[role].link !== "streaming");
}

/** The locale key of the pause line that names the missing counting sensors, or null when nothing is missing. */
export function pauseMessageKey(missing: readonly CountingRole[]): string | null {
  const thigh = missing.includes("thigh");
  const shank = missing.includes("shank");
  if (thigh && shank) return "flow.exercise.pause.both";
  if (thigh) return "flow.exercise.pause.thigh";
  if (shank) return "flow.exercise.pause.shank";
  return null;
}

/**
 * Where the exercise screen goes for a session status read fresh from the database. A router-cache restore (Back
 * after finishing) can show this screen for a session that is no longer in progress; only in_progress stays.
 *  - completed: on to its check-in (that page sends an answered one on to the summary);
 *  - reviewed, aborted: the summary;
 *  - anything else (scheduled): the server page decides, so it is rendered again.
 */
export type ExerciseRoute = "stay" | "checkIn" | "summary" | "refresh";

export function exerciseRouteFor(status: string): ExerciseRoute {
  switch (status) {
    case "in_progress":
      return "stay";
    case "completed":
      return "checkIn";
    case "reviewed":
    case "aborted":
      return "summary";
    default:
      return "refresh";
  }
}

/** sessionStorage key set once this tab has recorded frames into the session; read after a reload. */
export function recordedFlagKey(sessionId: string): string {
  return `mova.heelSlide.recorded.${sessionId}`;
}
