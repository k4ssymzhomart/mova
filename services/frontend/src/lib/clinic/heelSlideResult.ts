// Heel Slide result for the clinician patient page — server-side. Reads only through the two review RPCs from
// migration 0034 (clinician_patient_sessions, clinician_session_result), which authorize by an active care-team
// link, the patient's clinic admin, or a platform admin. It deliberately does not lean on clinic_patient_overview
// (0022), whose clinic-membership check is a different, looser rule: the section renders exactly when the review
// RPCs say the caller may see it, whatever the rest of the page decides.
//
// An unauthorized caller (the RPC answers null) and a patient without a Heel Slide session come back as "none" and
// render nothing, so nothing about the patient leaks. A failed read is different: it comes back as "error" and is
// shown as a load error, because an empty page would tell the clinician there is no session when the app simply
// could not find out.

import "server-only";

import { buildStoredProxySeries, DEFAULT_MAX_PAIR_SKEW_MS } from "@/lib/motion/flexion";
import { countOrientedRepetitions, heelSlideThresholds, MAX_REP_GAP_MS } from "@/lib/motion/reps";
import { createClient } from "@/lib/supabase/server";

import {
  buildHeelSlideView,
  type HeelSlideView,
  isUuid,
  type MotionDeps,
  pickHeelSlideSession,
  type ReviewSessionItem,
  sessionListOutcome,
} from "./heelSlideView";

const MOTION: MotionDeps = {
  buildStoredProxySeries,
  countOrientedRepetitions,
  heelSlideThresholds,
  maxRepGapMs: MAX_REP_GAP_MS,
  maxPairSkewMs: DEFAULT_MAX_PAIR_SKEW_MS,
};

export type HeelSlideSection =
  | { kind: "none" }
  /** The requested session is not one of this patient's Heel Slide sessions, or is no longer readable. */
  | { kind: "unavailable"; patientId: string; sessions: ReviewSessionItem[] }
  /**
   * A read failed. selectedId null: the session list itself did not load, so whether there are sessions is
   * unknown. Otherwise the list loaded and the result call for that session failed.
   */
  | { kind: "error"; patientId: string; sessions: ReviewSessionItem[]; selectedId: string | null }
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

  let list: ReturnType<typeof sessionListOutcome>;
  try {
    list = sessionListOutcome(await supabase.rpc("clinician_patient_sessions", { p_patient: patientId }));
  } catch {
    list = { kind: "error" };
  }
  if (list.kind === "error") return { kind: "error", patientId, sessions: [], selectedId: null };
  if (list.kind === "not_allowed") return { kind: "none" };

  const pick = pickHeelSlideSession(list.sessions, requestedSessionId);
  if (pick.kind === "none") return pick;
  if (pick.kind === "unavailable") return { kind: "unavailable", patientId, sessions: pick.sessions };

  let result: { data: unknown; error: unknown };
  try {
    result = await supabase.rpc("clinician_session_result", { p_session: pick.selected.id });
  } catch (error) {
    result = { data: null, error };
  }
  if (result.error) {
    return { kind: "error", patientId, sessions: pick.sessions, selectedId: pick.selected.id };
  }
  // null: access was revoked or the session removed between the two calls.
  const view = buildHeelSlideView(result.data, MOTION, { expectedPatientId: patientId });
  if (!view) return { kind: "unavailable", patientId, sessions: pick.sessions };
  return { kind: "ok", patientId, sessions: pick.sessions, view };
}
