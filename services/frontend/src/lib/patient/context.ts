// The clinical context every patient screen sits inside: post-operative day, operated side, and active
// precautions (НТЗ PAT-01, §4.3). Resolved once per request on the server; `cache` lets the layout and a page
// share the result.
//
// None of the three has a trustworthy source yet, so each resolves to an explicit "unknown"/"unavailable"
// state and the UI says so. Nothing is inferred:
//  - Surgery date, weight-bearing status and individual precautions arrive with the TKA clinical schema (#20).
//  - The operated side is deliberately NOT read from patients.affected_side. That column is the stroke app's
//    "affected side", which patients chose for themselves in the old Settings; showing it as the operated knee
//    could send a patient to the wrong leg. A clinic-recorded operated-knee field arrives with #20.

import { cache } from "react";

import { computePostOpDay, POD_CONVENTION, type PostOpDay } from "./pod";

export type OperatedSide = "left" | "right";

export type SideContext = { status: "known"; side: OperatedSide } | { status: "unknown" };

export type Precautions =
  | { status: "unavailable" }
  | {
      status: "known";
      /** Recorded wording, shown verbatim. */
      weightBearing: string | null;
      /** Individual precautions, shown verbatim. */
      items: string[];
    };

export interface PatientContext {
  postOp: PostOpDay;
  side: SideContext;
  precautions: Precautions;
}

// TODO(#20): read this profile's episode of care — surgery date, clinic-recorded operated knee, weight-bearing
// status and individual precautions — and keep the explicit unknown states for anything still missing.
export const getPatientContext = cache(async (profileId: string): Promise<PatientContext> => {
  const surgeryDate: string | null = null;
  return {
    postOp: computePostOpDay(surgeryDate, new Date(), POD_CONVENTION),
    side: { status: "unknown" },
    precautions: { status: "unavailable" },
  };
});
