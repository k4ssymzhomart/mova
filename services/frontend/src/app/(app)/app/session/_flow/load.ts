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

/** exercises.slug of the one exercise that runs end to end with real sensors (docs/heel-slide-path.md). */
export const HEEL_SLIDE_SLUG = "heel-slide";

export type Loaded<T> = { kind: "ok"; value: T } | { kind: "notFound" } | { kind: "error" };

export interface FlowSession {
  id: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  /** Catalog name, shown verbatim. null when the session has no exercise attached. */
  exerciseName: string | null;
}

export interface FlowSessionExercise extends FlowSession {
  exerciseSlug: string | null;
  /** exercises.scoring_rubric as stored. lib/motion/reps heelSlideThresholds validates what it reads from it. */
  scoringRubric: unknown;
  /**
   * Repetitions to do: prescriptions.dose.reps, else the exercise's default_dose.reps. null when neither holds a
   * positive whole number; the screen then counts without a target instead of inventing one.
   */
  targetReps: number | null;
}

export interface FlowPrescription {
  id: string;
  /** Catalog name, shown verbatim. */
  exerciseName: string | null;
}

/** One patient_ble_devices row as the sensor panel needs it. `role` is the lateralized body site (r_thigh, …). */
export interface SavedSensorDevice {
  role: string;
  device_id: string;
  device_name: string | null;
}

export interface FlowSensorContext {
  patientId: string;
  /**
   * The side a sensor binding is saved under (the l_/r_ of its body site): patients.affected_side when it is left
   * or right, otherwise null, and bindings then stay in the browser session. It only keys the binding and is never
   * shown as the operated knee; lib/patient/context.ts explains why that column is not trusted for display.
   */
  side: "left" | "right" | null;
  savedDevices: SavedSensorDevice[];
}

// Ids arrive from the URL. Anything that is not a uuid cannot match a row, and Postgres would reject it with
// 22P02, which would otherwise surface as a load error.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OneOrMany<T> = T | T[] | null | undefined;

/** PostgREST may return a to-one embed as an object or as a single-element array. */
function one<T>(value: OneOrMany<T>): T | null {
  return (Array.isArray(value) ? (value[0] ?? null) : value) ?? null;
}

/** `dose.reps` when it is a positive whole number. The dose jsonb has no enforced shape. */
function doseReps(dose: unknown): number | null {
  if (!dose || typeof dose !== "object") return null;
  const reps = (dose as Record<string, unknown>).reps;
  return typeof reps === "number" && Number.isInteger(reps) && reps > 0 ? reps : null;
}

const currentPatient = cache(async (): Promise<Loaded<{ id: string; affectedSide: string | null }>> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "notFound" };

  const { data, error } = await supabase
    .from("patients")
    .select("id, affected_side")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (error) return { kind: "error" };
  if (!data) return { kind: "notFound" };
  return { kind: "ok", value: { id: data.id as string, affectedSide: (data.affected_side as string | null) ?? null } };
});

const currentPatientId = cache(async (): Promise<Loaded<string>> => {
  const patient = await currentPatient();
  return patient.kind === "ok" ? { kind: "ok", value: patient.value.id } : patient;
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

/**
 * A session of the signed-in patient with what the exercise screen needs: the exercise's slug and rubric, and the
 * number of repetitions prescribed. A separate read from loadFlowSession so the other steps keep their narrow one.
 */
export const loadSessionExercise = cache(async (sessionId: string): Promise<Loaded<FlowSessionExercise>> => {
  if (!UUID.test(sessionId)) return { kind: "notFound" };
  const patient = await currentPatientId();
  if (patient.kind !== "ok") return patient;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, status, started_at, ended_at, exercise:exercises(name, slug, scoring_rubric, default_dose), prescription:prescriptions(dose)",
    )
    .eq("id", sessionId)
    .eq("patient_id", patient.value)
    .maybeSingle();
  if (error) return { kind: "error" };
  if (!data) return { kind: "notFound" };

  const exercise = one<{ name: string; slug: string | null; scoring_rubric: unknown; default_dose: unknown }>(
    data.exercise,
  );
  const prescription = one<{ dose: unknown }>(data.prescription);

  return {
    kind: "ok",
    value: {
      id: data.id as string,
      status: data.status as SessionStatus,
      startedAt: data.started_at as string,
      endedAt: (data.ended_at as string | null) ?? null,
      exerciseName: exercise?.name ?? null,
      exerciseSlug: exercise?.slug ?? null,
      scoringRubric: exercise?.scoring_rubric ?? null,
      targetReps: doseReps(prescription?.dose) ?? doseReps(exercise?.default_dose),
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

/**
 * What connecting sensors needs from the server: the patient id, the side bindings are saved under, and the
 * patient's saved bindings, so a device saved for another role is refused before it connects (lib/ble/liveSensors).
 */
export const loadSensorContext = cache(async (): Promise<Loaded<FlowSensorContext>> => {
  const patient = await currentPatient();
  if (patient.kind !== "ok") return patient;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("patient_ble_devices")
    .select("role, device_id, device_name")
    .eq("patient_id", patient.value.id);
  if (error) return { kind: "error" };

  const side = patient.value.affectedSide;
  return {
    kind: "ok",
    value: {
      patientId: patient.value.id,
      side: side === "left" || side === "right" ? side : null,
      savedDevices: (data ?? []).map((row) => ({
        role: String(row.role),
        device_id: String(row.device_id),
        device_name: (row.device_name as string | null) ?? null,
      })),
    },
  };
});
