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

// — the zero of every start ——————————————————————————————————————————————————————————

/**
 * The span one successful «Начать» took its zero over, on the receive-time clock of session_frames: `start`
 * inclusive, `end` exclusive. This is the shape summary.baseline_windows_ms stores.
 */
export interface BaselineWindowRecord {
  start: number;
  end: number;
}

/** More zeros than this in one session is not an exercise set; the oldest are dropped past it. */
export const MAX_BASELINE_WINDOWS = 100;

/**
 * sessionStorage key of the zeros this tab took for a session, oldest first. The list survives a reload, so a page
 * opened again still writes the zeros of the starts made before it into the summary.
 */
export function baselineWindowsKey(sessionId: string): string {
  return `mova.heelSlide.baselineWindows.${sessionId}`;
}

function isWindow(value: unknown): value is BaselineWindowRecord {
  if (typeof value !== "object" || value === null) return false;
  const { start, end } = value as Record<string, unknown>;
  return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) && end > start;
}

/**
 * The stored list, oldest first. Nothing stored yet is an empty list. A value that is not a list reads as null, the
 * same as storage that cannot be read: nothing is known about earlier starts. Entries that are not a valid span are
 * left out.
 */
export function parseBaselineWindows(raw: string | null): BaselineWindowRecord[] | null {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter(isWindow)
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start)
    .slice(-MAX_BASELINE_WINDOWS);
}

/** The list with `next` added in time order. A repeat of a start already listed replaces it. */
export function appendBaselineWindow(
  list: readonly BaselineWindowRecord[],
  next: BaselineWindowRecord,
): BaselineWindowRecord[] {
  if (!isWindow(next)) return [...list];
  return [...list.filter((entry) => entry.start !== next.start), { start: next.start, end: next.end }]
    .sort((a, b) => a.start - b.start)
    .slice(-MAX_BASELINE_WINDOWS);
}

/**
 * The notice shown when the session had recorded before this screen opened (a reload, most often).
 *  - `earlierStarts` > 0: this tab kept the zero of at least one earlier start, and the summary carries it, so the
 *    clinician recount counts what was done since that start. The patient is told not to repeat those reps.
 *  - 0 or null (no storage, or no earlier zero kept in this tab): nothing ties the earlier reps to a zero, so they
 *    cannot be recounted. The patient is asked for the whole set.
 */
export function restartNoticeKey(earlierStarts: number | null): string {
  return earlierStarts !== null && earlierStarts > 0 ? "flow.exercise.restarted" : "flow.exercise.restartedFullSet";
}
