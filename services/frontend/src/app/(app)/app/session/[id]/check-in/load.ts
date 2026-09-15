// Whether this session's check-in has already been submitted. The session itself is read, and checked to be the
// signed-in patient's, by loadFlowSession before this runs. session_check_ins.session_id is unique, and
// submit_session_check_in takes the row's patient from the session, so a row found for that session is this
// patient's.
//
// A failed read comes back as "error", not as "not submitted": the page then says the data did not load instead
// of asking questions that may already be answered.

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import type { Loaded } from "../../_flow/load";

export const loadCheckInSubmitted = cache(async (sessionId: string): Promise<Loaded<boolean>> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("session_check_ins")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) return { kind: "error" };
  return { kind: "ok", value: data !== null };
});
