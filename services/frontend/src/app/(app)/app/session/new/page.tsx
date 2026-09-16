import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Training entry point: open a session and hand off to /app/session/[id]. Reuses a recent still-open
 * session instead of spawning empties (so repeat clicks / accidental prefetches don't pile up). Link to
 * this with prefetch disabled. An optional ?exercise=<slug> picks a specific prescribed exercise (one of
 * the 8 knee-rehab slugs, or any other catalog slug) — omit it for the default camera reach/gait flow.
 */
export default async function NewSession({
  searchParams,
}: {
  searchParams: { exercise?: string };
}) {
  const supabase = createClient();
  const exerciseSlug = searchParams.exercise ?? null;

  const { data: open } = await supabase
    .from("sessions")
    .select("id, started_at, exercise:exercises(slug)")
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const openExercise = open?.exercise as { slug: string } | { slug: string }[] | null | undefined;
  const openExerciseSlug = (Array.isArray(openExercise) ? openExercise[0]?.slug : openExercise?.slug) ?? null;
  // Only reuse an open session if it's for the same exercise — otherwise a link to a different
  // prescribed exercise within the 30-minute window would silently reopen the wrong one.
  if (open && openExerciseSlug === exerciseSlug && Date.now() - new Date(open.started_at).getTime() < 30 * 60 * 1000) {
    redirect(`/app/session/${open.id}`);
  }

  const { data: patient } = await supabase.from("patients").select("id").maybeSingle();
  const { data: bleDevices } = patient
    ? await supabase
        .from("patient_ble_devices")
        .select("role, device_id, device_name, last_connected_at")
        .eq("patient_id", patient.id)
    : { data: null };

  const { data, error } = await supabase.rpc("start_training_session", {
    p_exercise_slug: exerciseSlug,
    p_device_info: { client: "web", via: "new", ble_devices: bleDevices ?? [] },
  });
  if (error || !data) redirect("/app");
  const s = Array.isArray(data) ? data[0] : data;
  redirect(`/app/session/${s.id}`);
}
