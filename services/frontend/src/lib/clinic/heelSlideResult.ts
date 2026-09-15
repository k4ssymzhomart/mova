// Heel Slide result for the clinician patient page — server-side. Reads only through the two review RPCs from
// migration 0034 (clinician_patient_sessions, clinician_session_result), which authorize by an active care-team
// link, the patient's clinic admin, or a platform admin. It deliberately does not lean on clinic_patient_overview
// (0022), whose clinic-membership check is a different, looser rule: the section renders exactly when the review
// RPCs say the caller may see it, whatever the rest of the page decides.
//
// Nothing sensitive leaks through the states: an unauthorized caller, a failed list call, or a patient without a
// Heel Slide session all come back as "none" and render nothing.

import "server-only";

import { buildStoredProxySeries } from "@/lib/motion/flexion";
import { countOrientedRepetitions, heelSlideThresholds } from "@/lib/motion/reps";
import { createClient } from "@/lib/supabase/server";

import {
  buildHeelSlideView,
  type HeelSlideView,
  isUuid,
  type MotionDeps,
  parseSessionList,
  pickHeelSlideSession,
  type ReviewSessionItem,
} from "./heelSlideView";

const MOTION: MotionDeps = { buildStoredProxySeries, countOrientedRepetitions, heelSlideThresholds };

export type HeelSlideSection =
  | { kind: "none" }
  /** The requested session is not one of this patient's Heel Slide sessions, or is no longer readable. */
  | { kind: "unavailable"; patientId: string; sessions: ReviewSessionItem[] }
  /** The list loaded but the result call failed. Not "not found": the session exists. */
  | { kind: "error"; patientId: string; sessions: ReviewSessionItem[]; selectedId: string }
  | { kind: "ok"; patientId: string; sessions: ReviewSessionItem[]; view: HeelSlideView };

/**
 * The Heel Slide section for `patientId` (patients.id). `requestedSessionId` is the `?session=` search param;
 * without it the newest Heel Slide session is shown. The recount runs here, on the full stored series.
 */
export async function loadHeelSlideSection(
  patientId: string,
  requestedSessionId: string | undefined,
): Promise<HeelSlideSection> {
  if (!isUuid(patientId)) return { kind: "none" };
  const supabase = createClient();

  const list = await supabase.rpc("clinician_patient_sessions", { p_patient: patientId });
  if (list.error) return { kind: "none" };
  const sessions = parseSessionList(list.data);
  if (!sessions) return { kind: "none" };

  const pick = pickHeelSlideSession(sessions, requestedSessionId);
  if (pick.kind === "none") return pick;
  if (pick.kind === "unavailable") return { kind: "unavailable", patientId, sessions: pick.sessions };

  const result = await supabase.rpc("clinician_session_result", { p_session: pick.selected.id });
  if (result.error) {
    return { kind: "error", patientId, sessions: pick.sessions, selectedId: pick.selected.id };
  }
  // null: access was revoked or the session removed between the two calls.
  const view = buildHeelSlideView(result.data, MOTION, { expectedPatientId: patientId });
  if (!view) return { kind: "unavailable", patientId, sessions: pick.sessions };
  return { kind: "ok", patientId, sessions: pick.sessions, view };
}
