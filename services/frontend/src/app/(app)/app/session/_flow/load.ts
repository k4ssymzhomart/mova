// Server-side reads for the exercise flow. Every read is filtered to the signed-in patient explicitly: RLS is
// being reworked (#20), so a row is never taken to be this patient's just because a policy let it through.
//
// A failed query comes back as "error", not "notFound". Telling a patient their session does not exist when the
// connection dropped would be untrue.

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/** public.session_status (supabase/migrations/0002_schemas_and_enums.sql). */
export type SessionStatus = "scheduled" | "in_progress" | "completed" | "aborted" | "reviewed";

/** Sessions that have ended one way or another. Their only destination in the flow is the summary. */
export const FINISHED_STATUSES: readonly SessionStatus[] = ["completed", "reviewed", "aborted"];

export type Loaded<T> = { kind: "ok"; value: T } | { kind: "notFound" } | { kind: "error" };

export interface FlowSession {
  id: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  /** Catalog name, shown verbatim. null when the session has no exercise attached. */
  exerciseName: string | null;
}

export interface FlowPrescription {
  id: string;
  /** Catalog name, shown verbatim. */
  exerciseName: string | null;
}

// Ids arrive from the URL. Anything that is not a uuid cannot match a row, and Postgres would reject it with
// 22P02, which would otherwise surface as a load error.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OneOrMany<T> = T | T[] | null | undefined;

/** PostgREST may return a to-one embed as an object or as a single-element array. */
function one<T>(value: OneOrMany<T>): T | null {
  return (Array.isArray(value) ? (value[0] ?? null) : value) ?? null;
}

const currentPatientId = cache(async (): Promise<Loaded<string>> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "notFound" };

  const { data, error } = await supabase.from("patients").select("id").eq("profile_id", user.id).maybeSingle();
  if (error) return { kind: "error" };
  return data ? { kind: "ok", value: data.id as string } : { kind: "notFound" };
});

/** A session of the signed-in patient, with its exercise name. */
export const loadFlowSession = cache(async (sessionId: string): Promise<Loaded<FlowSession>> => {
  if (!UUID.test(sessionId)) return { kind: "notFound" };
  const patient = await currentPatientId();
  if (patient.kind !== "ok") return patient;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("id, status, started_at, ended_at, exercise:exercises(name)")
    .eq("id", sessionId)
    .eq("patient_id", patient.value)
    .maybeSingle();
  if (error) return { kind: "error" };
  if (!data) return { kind: "notFound" };

  return {
    kind: "ok",
    value: {
      id: data.id as string,
      status: data.status as SessionStatus,
      startedAt: data.started_at as string,
      endedAt: (data.ended_at as string | null) ?? null,
      exerciseName: one<{ name: string }>(data.exercise)?.name ?? null,
    },
  };
});

/** An active prescription of the signed-in patient, with its exercise name. Paused or ended ones do not start. */
export const loadActivePrescription = cache(async (prescriptionId: string): Promise<Loaded<FlowPrescription>> => {
  if (!UUID.test(prescriptionId)) return { kind: "notFound" };
  const patient = await currentPatientId();
  if (patient.kind !== "ok") return patient;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("prescriptions")
    .select("id, exercise:exercises(name)")
    .eq("id", prescriptionId)
    .eq("patient_id", patient.value)
    .eq("status", "active")
    .maybeSingle();
  if (error) return { kind: "error" };
  if (!data) return { kind: "notFound" };

  return {
    kind: "ok",
    value: {
      id: data.id as string,
      exerciseName: one<{ name: string }>(data.exercise)?.name ?? null,
    },
  };
});
