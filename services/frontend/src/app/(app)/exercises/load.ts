// The library's only database access: whether the signed-in patient has an active Heel Slide prescription to start.
// Read only. It follows Today's read (patient → newest active program → its active prescriptions) without Today's
// provisioning call, which writes. Every query is filtered to the signed-in patient explicitly, not left to RLS (#20).
// A failed query comes back as "error", never as "none": the page must not tell a patient an exercise is not
// prescribed when it could not check.

import { heelSlidePrescriptionId, type HeelSlidePrescription } from "@/components/exercises/library";
import { createClient } from "@/lib/supabase/server";

type ExerciseRef = { slug: string | null };

export async function loadHeelSlidePrescription(): Promise<HeelSlidePrescription> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The (app) layout redirects a signed-out visitor; without a user there is nothing of theirs to start.
  if (!user) return { status: "none" };

  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (patientError) return { status: "error" };
  if (!patient) return { status: "none" };

  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id")
    .eq("patient_id", patient.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (programError) return { status: "error" };
  if (!program) return { status: "none" };

  const { data, error } = await supabase
    .from("prescriptions")
    .select("id, exercise:exercises(slug)")
    .eq("patient_id", patient.id)
    .eq("program_id", program.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) return { status: "error" };

  const rows = (data ?? []) as unknown as { id: string; exercise: ExerciseRef | ExerciseRef[] | null }[];
  const prescriptionId = heelSlidePrescriptionId(rows);
  return prescriptionId ? { status: "ok", prescriptionId } : { status: "none" };
}
