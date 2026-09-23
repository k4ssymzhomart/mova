// What the clinician sees and changes on a patient's plan.
//
// The plan is the set of prescriptions: which exercises this patient is asked to do, how many repetitions, how
// often. Reading it is a plain select — a clinician with an active care-team link passes the row-level rule. Writing
// it goes through clinic_set_prescription (migration 0043), which re-checks that same rule in the database, so the
// browser is never the thing deciding who may prescribe.
//
// The catalogue itself is static (lib/exercises/catalog.ts). This module joins the two: every catalogue exercise,
// with its prescription when it has one. An exercise the database does not carry is reported as unavailable rather
// than silently dropped, because a clinician looking for it deserves to know why it cannot be assigned.

import "server-only";

import { EXERCISE_CATALOG, type ExerciseEntry } from "@/lib/exercises/catalog";
import { createClient } from "@/lib/supabase/server";

export interface PlanRow {
  /** The catalogue entry: name, target, sensors, video. */
  entry: ExerciseEntry;
  /** The exercise row's id in the database, or null when the catalogue entry has no row to prescribe. */
  exerciseId: string | null;
  prescriptionId: string | null;
  /** public.prescription_status: draft | active | paused | completed | cancelled. */
  status: string | null;
  reps: number | null;
  perWeek: number | null;
}

export type PlanResult = { status: "ok"; rows: PlanRow[] } | { status: "error" };

interface ExerciseRow {
  id: string;
  slug: string;
}
interface PrescriptionRow {
  id: string;
  exercise_id: string;
  status: string;
  dose: { reps?: number | null } | null;
  frequency_per_week: number | null;
}

/** Every catalogue exercise for this patient, with the prescription it has. A failed read is an error, not "none". */
export async function loadPatientPlan(patientId: string): Promise<PlanResult> {
  const supabase = createClient();
  const [exercises, prescriptions] = await Promise.all([
    supabase.from("exercises").select("id, slug"),
    supabase
      .from("prescriptions")
      .select("id, exercise_id, status, dose, frequency_per_week")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: true }),
  ]);
  if (exercises.error || prescriptions.error) return { status: "error" };

  const idBySlug = new Map<string, string>();
  for (const row of (exercises.data ?? []) as ExerciseRow[]) idBySlug.set(row.slug, row.id);

  // The newest row per exercise wins: clinic_set_prescription updates in place, but a hand-made older row may exist.
  const byExercise = new Map<string, PrescriptionRow>();
  for (const row of (prescriptions.data ?? []) as PrescriptionRow[]) byExercise.set(row.exercise_id, row);

  return {
    status: "ok",
    rows: EXERCISE_CATALOG.map((entry) => {
      const exerciseId = idBySlug.get(entry.slug) ?? null;
      const prescription = exerciseId ? (byExercise.get(exerciseId) ?? null) : null;
      return {
        entry,
        exerciseId,
        prescriptionId: prescription?.id ?? null,
        status: prescription?.status ?? null,
        reps: typeof prescription?.dose?.reps === "number" ? prescription.dose.reps : null,
        perWeek: prescription?.frequency_per_week ?? null,
      };
    }),
  };
}
