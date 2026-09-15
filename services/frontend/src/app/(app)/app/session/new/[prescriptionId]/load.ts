// The sensors step's own read: which exercise a prescription is for. Only Heel Slide runs on the sensors path
// (docs/heel-slide-path.md), so the step opens a session for nothing else. Filtered to the signed-in patient
// explicitly, like every flow read (_flow/load.ts), and to active prescriptions, the same rows the step loads.

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import type { Loaded } from "../../_flow/load";

/** PostgREST may return a to-one embed as an object or as a single-element array. */
function one<T>(value: T | T[] | null | undefined): T | null {
  return (Array.isArray(value) ? (value[0] ?? null) : value) ?? null;
}

/** exercises.slug of this patient's active prescription; null when the exercise has none. */
export const loadPrescriptionExerciseSlug = cache(
  async (prescriptionId: string, patientId: string): Promise<Loaded<string | null>> => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("prescriptions")
      .select("id, exercise:exercises(slug)")
      .eq("id", prescriptionId)
      .eq("patient_id", patientId)
      .eq("status", "active")
      .maybeSingle();
    if (error) return { kind: "error" };
    if (!data) return { kind: "notFound" };
    const slug = one<{ slug: string | null }>(data.exercise as { slug: string | null } | { slug: string | null }[])?.slug;
    return { kind: "ok", value: typeof slug === "string" ? slug : null };
  },
);
