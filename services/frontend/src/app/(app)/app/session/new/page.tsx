import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Training entry point: open a session and hand off to /app/session/[id]. Reuses a recent still-open
 * session instead of spawning empties (so repeat clicks / accidental prefetches don't pile up). Link to
 * this with prefetch disabled.
 */
export default async function NewSession() {
  const supabase = createClient();

  const { data: open } = await supabase
    .from("sessions")
    .select("id, started_at")
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (open && Date.now() - new Date(open.started_at).getTime() < 30 * 60 * 1000) {
    redirect(`/app/session/${open.id}`);
  }

  const { data, error } = await supabase.rpc("start_training_session", {
    p_exercise_slug: null,
    p_device_info: { client: "web", via: "new" },
  });
  if (error || !data) redirect("/app");
  const s = Array.isArray(data) ? data[0] : data;
  redirect(`/app/session/${s.id}`);
}
